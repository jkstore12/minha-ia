import { after, NextResponse } from "next/server";
import { z } from "zod";
import { executeAgentActions } from "@/lib/agent/actions";
import { transcribeAudio } from "@/lib/ai/audio";
import { embedText, searchAgentKnowledge, type KnowledgeSearchResult } from "@/lib/ai/embeddings";
import { extractBrainUpdates, resolveRuntimeModel, runBrain, type AgentKnowledge, type BrainMessage, type Memory } from "@/lib/ai/brain";
import {
  CHAT_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENTS_PER_MESSAGE,
  isAudioMime,
  isImageMime,
  isPdfMime,
  isTextLikeMime,
  type PendingAttachment,
  type PreparedAttachment,
} from "@/lib/chat/attachments";
import { env, hasAiEnv, hasSupabaseEnv } from "@/lib/env";
import { consume as consumeRateLimit } from "@/lib/rate-limit";
import { createLogger, extractOrCreateRequestId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { parseUserPreferences } from "@/lib/user-preferences";
import { truncateTitle } from "@/lib/utils";

const ONE_MINUTE_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function withRequestId<T extends Response>(response: T, requestId: string): T {
  response.headers.set("x-request-id", requestId);
  return response;
}

function jsonWithRequestId(body: unknown, init: ResponseInit | undefined, requestId: string): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const runtime = "nodejs";

const ChatRequest = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1, "Digite uma mensagem.").max(8000, "A mensagem e longa demais."),
  model: z.string().trim().min(1).max(160).optional(),
  attachments: z
    .array(
      z.object({
        storage_path: z.string().min(3).max(600),
        file_name: z.string().min(1).max(240),
        mime_type: z.string().min(1).max(160),
        size_bytes: z.number().int().min(0).max(25 * 1024 * 1024),
      }),
    )
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
});

function shouldUseWebSearch(message: string) {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const terms = [
    "pesquise",
    "pesquisar",
    "procure na internet",
    "busque na internet",
    "busca na web",
    "pesquisa na web",
    "internet",
    "web",
    "noticia",
    "noticias",
    "site oficial",
    "fonte",
    "fontes",
    "hoje",
    "agora",
    "atual",
    "atuais",
    "ultima",
    "ultimas",
    "recente",
    "recentes",
    "preço",
    "cotação",
    "valor atual",
    "lancamento",
    "resultado",
    "placar",
    "clima",
    "tempo em",
    "2026",
  ];

  return terms.some((term) => normalized.includes(term));
}

function shouldLearnFromMessage(message: string) {
  if (!env.aiAutoLearning) return false;

  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  const learningSignals = [
    "guarde",
    "memorize",
    "lembre",
    "prefiro",
    "eu prefiro",
    "meu objetivo",
    "minha meta",
    "meu trabalho",
    "minha empresa",
    "sou ",
    "eu sou",
    "quero que você",
    "sempre responda",
    "não faca",
  ];

  return learningSignals.some((signal) => normalized.includes(signal));
}

async function prepareAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  attachments: PendingAttachment[],
): Promise<PreparedAttachment[]> {
  const prepared: PreparedAttachment[] = [];

  for (const attachment of attachments) {
    if (!attachment.storage_path.startsWith(`${userId}/`)) {
      throw new Error("Arquivo invalido para este usuário.");
    }

    const { data, error } = await supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .download(attachment.storage_path);

    if (error || !data) {
      throw new Error(`Não foi possível ler o arquivo ${attachment.file_name}.`);
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const item: PreparedAttachment = { ...attachment };

    if (isTextLikeMime(attachment.mime_type, attachment.file_name)) {
      item.text = buffer.toString("utf8").slice(0, 60_000);
    } else if (isAudioMime(attachment.mime_type, attachment.file_name)) {
      const transcription = await transcribeAudio({
        buffer,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
      });
      item.transcription = transcription.text;
      item.transcriptionModel = transcription.model;
      item.transcriptionError = transcription.error;
    } else if (isImageMime(attachment.mime_type) || isPdfMime(attachment.mime_type)) {
      item.dataUrl = `data:${attachment.mime_type};base64,${buffer.toString("base64")}`;
    }

    prepared.push(item);
  }

  return prepared;
}

export async function POST(request: Request) {
  const requestId = extractOrCreateRequestId(request);
  const logger = createLogger("chat", requestId);

  if (!hasSupabaseEnv()) {
    return withRequestId(NextResponse.json({ error: "Supabase não configurado." }, { status: 503 }), requestId);
  }

  if (!hasAiEnv()) {
    return withRequestId(
      NextResponse.json(
        { error: "IA não configurada. Defina AI_API_KEY, OPENAI_API_KEY ou OPENROUTER_API_KEY em .env.local." },
        { status: 503 },
      ),
      requestId,
    );
  }

  logger.info("chat.received", { messageBytes: request.headers.get("content-length") ?? "unknown" });

  const parsed = ChatRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithRequestId({ error: parsed.error.issues[0]?.message || "Entrada inválida." }, { status: 400 }, requestId);
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonWithRequestId({ error: "Sessão expirada. Entre novamente." }, { status: 401 }, requestId);
  }

  // Rate limit por usuario. Bloqueia abuso antes de qualquer chamada
  // cara (IA, transcricao, etc). Headers expostos no response para o
  // client poder mostrar feedback. Usa Upstash se UPSTASH_REDIS_REST_*
  // estiver setado, senao cai para in-memory.
  const perMinute = await consumeRateLimit(`chat:user:${user.id}`, env.chatRateLimitPerMinute, ONE_MINUTE_MS);
  if (!perMinute.allowed) {
    return jsonWithRequestId(
      { error: "Muitas mensagens em pouco tempo. Aguarde um instante." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(perMinute.resetMs / 1000)),
          "X-RateLimit-Limit": String(perMinute.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(perMinute.resetMs / 1000)),
        },
      },
      requestId,
    );
  }

  const perDay = await consumeRateLimit(`chat:user:${user.id}:day`, env.chatRateLimitPerDay, ONE_DAY_MS);
  if (!perDay.allowed) {
    return jsonWithRequestId(
      { error: "Limite diario de mensagens atingido." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(perDay.resetMs / 1000)),
          "X-RateLimit-Limit": String(perDay.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(perDay.resetMs / 1000)),
        },
      },
      requestId,
    );
  }

  const { message, model } = parsed.data;
  const attachments = parsed.data.attachments || [];
  let preparedAttachments: PreparedAttachment[] = [];
  let effectiveMessage = message;
  let conversationId = parsed.data.conversationId;
  let conversationSummary: string | null = null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("preferences")
    .eq("id", user.id)
    .single();

  const userPreferences = parseUserPreferences(profile?.preferences);

  try {
    preparedAttachments = attachments.length ? await prepareAttachments(supabase, user.id, attachments) : [];
  } catch {
    return jsonWithRequestId({ error: "Não foi possível preparar os anexos enviados." }, { status: 400 }, requestId);
  }

  const audioTranscriptions = preparedAttachments
    .filter((attachment) => isAudioMime(attachment.mime_type, attachment.file_name))
    .map((attachment) => {
      if (attachment.transcription) {
        return `Áudio "${attachment.file_name}" transcrito:\n${attachment.transcription}`;
      }
      return `Áudio "${attachment.file_name}" sem transcrição automática: ${attachment.transcriptionError || "transcrição indisponível"}.`;
    });
  const failedAudioTranscriptions = preparedAttachments.filter(
    (attachment) => isAudioMime(attachment.mime_type, attachment.file_name) && !attachment.transcription,
  );

  if (failedAudioTranscriptions.length) {
    return jsonWithRequestId(
      {
        error:
          failedAudioTranscriptions[0]?.transcriptionError ||
          "Recebi seu áudio, mas não consegui transcrever agora. Tente reenviar ou envie um arquivo menor.",
      },
      { status: 400 },
      requestId,
    );
  }

  const audioResponseIntro = preparedAttachments
    .filter((attachment) => isAudioMime(attachment.mime_type, attachment.file_name) && attachment.transcription)
    .map((attachment) => `🎤 Você disse: ${attachment.transcription}`)
    .join("\n\n");

  if (audioTranscriptions.length) {
    effectiveMessage = [message, "", "Transcrições de áudio anexadas:", audioTranscriptions.join("\n\n")]
      .filter((part) => part !== null && part !== undefined)
      .join("\n");
  }

  const webSearch =
    userPreferences.webSearchMode === "always"
      ? true
      : userPreferences.webSearchMode === "off"
        ? false
        : shouldUseWebSearch(effectiveMessage);
  let usedModel = resolveRuntimeModel(model || userPreferences.preferredModel || undefined, webSearch);

  if (conversationId) {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id, summary")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (error || !conversation) {
      return jsonWithRequestId({ error: "Conversa não encontrada." }, { status: 404 }, requestId);
    }

    conversationSummary = conversation.summary;
  } else {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: truncateTitle(effectiveMessage) })
      .select("id, summary")
      .single();

    if (error || !conversation) {
      return jsonWithRequestId({ error: "Não foi possível criar a conversa." }, { status: 500 }, requestId);
    }

    conversationId = conversation.id;
    conversationSummary = conversation.summary;
  }

  const contextPromise = Promise.all([
    supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(env.aiFastMode ? 12 : 24),
    supabase
      .from("memories")
      .select("kind, content, confidence")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(env.aiFastMode ? 12 : 30),
    supabase
      .from("agents")
      .select("id, name, domain, description, system_prompt, tools, model, is_orchestrator, is_fallback")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("is_orchestrator", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(env.aiFastMode ? 6 : 12),
  ]);

  const { data: userMessage, error: userMessageError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: "user",
      content: effectiveMessage,
    })
    .select("id")
    .single();

  if (userMessageError || !userMessage) {
    return jsonWithRequestId({ error: "Não foi possível salvar sua mensagem." }, { status: 500 }, requestId);
  }

  if (attachments.length) {
    const { error: attachmentInsertError } = await supabase.from("message_attachments").insert(
      attachments.map((attachment) => ({
        message_id: userMessage.id,
        conversation_id: conversationId,
        user_id: user.id,
        bucket_id: CHAT_ATTACHMENTS_BUCKET,
        storage_path: attachment.storage_path,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
      })),
    );

    if (attachmentInsertError) {
      return jsonWithRequestId({ error: "Não foi possível salvar os anexos da mensagem." }, { status: 500 }, requestId);
    }
  }

  let assistantMessage: string;
  let actualUsedModel = usedModel;
  let fallbackUsed = false;
  let modelAttempts: Array<{ model: string; status: "success" | "error"; error?: string }> = [];
  const actionResults = await executeAgentActions({ supabase, user, message: effectiveMessage });

  try {
    const [recentMessages, memories, agents] = await contextPromise;
    const agentRows = agents.data || [];
    const activeAgent = userPreferences.activeAgentId
      ? agentRows.find((agent) => agent.id === userPreferences.activeAgentId)
      : null;
    const orderedAgents = activeAgent
      ? [activeAgent, ...agentRows.filter((agent) => agent.id !== activeAgent.id)]
      : agentRows;
    const requestedModel = model || activeAgent?.model || userPreferences.preferredModel || undefined;
    usedModel = resolveRuntimeModel(requestedModel || undefined, webSearch);

    // RAG: tenta busca por similaridade vetorial. Se falhar (sem
    // embeddings, sem API key, etc), cai para a busca por prioridade.
    let knowledgeData: AgentKnowledge[] = [];
    if (activeAgent?.id) {
      try {
        const queryEmbedding = await embedText(effectiveMessage);
        const similar = await searchAgentKnowledge(supabase, {
          queryEmbedding,
          matchCount: env.aiFastMode ? 12 : 30,
          agentId: activeAgent.id,
          userId: user.id,
        });
        knowledgeData = similar.map((k: KnowledgeSearchResult) => ({
          title: k.title,
          kind: k.kind,
          content: k.content,
          tags: k.tags,
          priority: k.priority,
          source_url: k.source_url,
        }));
      } catch (err) {
        console.warn("[chat] RAG indisponivel, usando busca por prioridade:", err instanceof Error ? err.message : err);
        const fallback = await supabase
          .from("agent_knowledge")
          .select("title, kind, content, tags, priority, source_url")
          .eq("user_id", user.id)
          .eq("agent_id", activeAgent.id)
          .eq("is_active", true)
          .order("priority", { ascending: true })
          .order("updated_at", { ascending: false })
          .limit(env.aiFastMode ? 12 : 30);
        knowledgeData = (fallback.data || []) as AgentKnowledge[];
      }
    }

    const brainResult = await runBrain({
      userMessage: effectiveMessage,
      conversationSummary,
      model: requestedModel || undefined,
      webSearch,
      attachments: preparedAttachments,
      actionResults: actionResults.results,
      memories: userPreferences.memoryMode === "off" ? [] : (((memories.data || []) as Memory[])),
      knowledge: knowledgeData,
      agents: orderedAgents,
      activeAgentId: activeAgent?.id || "",
      recentMessages: (((recentMessages.data || []).reverse() as BrainMessage[])).concat({ role: "user", content: effectiveMessage }),
      userPreferences,
    });
    assistantMessage = brainResult.text;
    actualUsedModel = brainResult.usedModel;
    fallbackUsed = brainResult.fallbackUsed;
    modelAttempts = brainResult.attempts;
  } catch {
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      conversation_id: conversationId,
      level: "error",
      message: "Falha ao executar o cérebro de IA.",
      metadata: {
        model,
        used_model: actualUsedModel,
        web_search: webSearch,
        attachment_count: attachments.length,
        audio_transcriptions: audioTranscriptions.length,
        action_results: actionResults.results,
        agent_steps: actionResults.steps,
        model_attempts: modelAttempts,
      },
    });
    return jsonWithRequestId({ error: "A IA não conseguiu responder agora. Verifique provedor, chave e modelo." }, { status: 502 }, requestId);
  }

  if (!assistantMessage) {
    assistantMessage = "Não consegui gerar uma resposta útil agora. Pode reformular sua mensagem?";
  }

  if (audioResponseIntro) {
    assistantMessage = `${audioResponseIntro}\n\n${assistantMessage}`;
  }

  const { error: assistantMessageError } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    role: "assistant",
    content: assistantMessage,
  });

  if (assistantMessageError) {
    return jsonWithRequestId({ error: "Não foi possível salvar a resposta da IA." }, { status: 500 }, requestId);
  }

  const finalConversationId = conversationId;
  const finalAssistantMessage = assistantMessage;
  const finalModel = actualUsedModel;
  const finalUsedModel = actualUsedModel;
  const finalFallbackUsed = fallbackUsed;
  const finalModelAttempts = modelAttempts;
  const shouldRunLearning = userPreferences.memoryMode === "auto" && shouldLearnFromMessage(effectiveMessage);

  after(async () => {
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      conversation_id: finalConversationId,
      level: "success",
      message: `Resposta gerada${webSearch ? " com busca web" : ""}.`,
      metadata: {
        model,
        used_model: finalUsedModel,
        provider: env.aiProvider,
        web_search: webSearch,
        attachment_count: attachments.length,
        audio_transcriptions: audioTranscriptions.length,
        action_results: actionResults.results,
        agent_steps: actionResults.steps,
        fallback_used: finalFallbackUsed,
        model_attempts: finalModelAttempts,
        fast_mode: env.aiFastMode,
      },
    });

    if (!shouldRunLearning) {
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", finalConversationId)
        .eq("user_id", user.id);
      return;
    }

    const brainUpdates = await extractBrainUpdates({
      userMessage: effectiveMessage,
      assistantMessage: finalAssistantMessage,
      previousSummary: conversationSummary,
      model: finalModel,
    });

    if (brainUpdates.summary) {
      await supabase
        .from("conversations")
        .update({ summary: brainUpdates.summary, updated_at: new Date().toISOString() })
        .eq("id", finalConversationId)
        .eq("user_id", user.id);
    } else {
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", finalConversationId)
        .eq("user_id", user.id);
    }

    if (brainUpdates.memories.length) {
      await supabase.from("memories").insert(
        brainUpdates.memories.map((memory) => ({
          user_id: user.id,
          kind: memory.kind,
          content: memory.content,
          confidence: memory.confidence,
          source_conversation_id: finalConversationId,
        })),
      );
    }
  });

  logger.info("chat.completed", {
    conversationId,
    userId: user.id,
    model: actualUsedModel,
    fallbackUsed,
    webSearch,
    attachmentCount: attachments.length,
  });

  return jsonWithRequestId({
    conversationId,
    assistantMessage,
    model: actualUsedModel || model || userPreferences.preferredModel || env.aiModel,
    usedModel: actualUsedModel,
    provider: env.aiProvider,
    webSearch,
    fallbackUsed,
    modelAttempts,
    actionResults: actionResults.results,
    agentSteps: actionResults.steps,
  }, undefined, requestId);
}
