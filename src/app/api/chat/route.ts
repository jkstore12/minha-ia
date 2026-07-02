import { after } from "next/server";
import { z } from "zod";
import { executeAgentActions } from "@/lib/agent/actions";
import { transcribeAudio } from "@/lib/ai/audio";
import { embedText, searchAgentKnowledge, type KnowledgeSearchResult } from "@/lib/ai/embeddings";
import {
  extractBrainUpdates,
  resolveRuntimeModel,
  runBrain,
  runBrainStream,
  type AgentKnowledge,
  type BrainMessage,
  type Memory,
  type RunBrainOutput,
} from "@/lib/ai/brain";
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
import { createLogger, extractOrCreateRequestId, type Logger } from "@/lib/log";
import { jsonError, jsonResult } from "@/lib/api/server";
import { createClient } from "@/lib/supabase/server";
import { parseUserPreferences, type UserPreferences } from "@/lib/user-preferences";
import { truncateTitle } from "@/lib/utils";

const ONE_MINUTE_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const runtime = "nodejs";

const ChatRequest = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1, "Digite uma mensagem.").max(8000, "A mensagem e longa demais."),
  model: z.string().trim().min(1).max(160).optional(),
  /**
   * Quando true, a response e uma stream NDJSON com eventos
   * { type: "meta" | "delta" | "done" | "error" }. Default: false
   * (response JSON completa, comportamento legado).
   */
  stream: z.boolean().optional().default(false),
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

type ChatContext = {
  requestId: string;
  logger: Logger;
  supabase: Awaited<ReturnType<typeof createClient>>;
  // User do Supabase Auth; o tipo vem de @supabase/supabase-js. Mantemos
  // como unknown para nao acoplar o helper ao tipo completo, que traria
  // ~200 linhas de generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
  conversationId: string;
  userMessageId: string;
  effectiveMessage: string;
  webSearch: boolean;
  usedModel: string;
  userPreferences: UserPreferences;
  orderedAgents: import("@/lib/ai/brain").BrainAgentProfile[];
  knowledgeData: AgentKnowledge[];
  actionResults: { results: string[]; steps: import("@/lib/agent/actions").AgentStep[] };
  recentMessages: BrainMessage[];
  attachments: PendingAttachment[];
  preparedAttachments: PreparedAttachment[];
  audioTranscriptions: string[];
  audioResponseIntro: string;
  model: string | undefined;
  conversationSummary: string | null;
};

type PrepError = {
  status: number;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
};

/**
 * Faz toda a prep do chat ate o ponto de chamar o brain:
 *  - auth + rate limit
 *  - parse de input
 *  - fetch profile/preferencias
 *  - prepare attachments + audio transcription
 *  - ensure conversation (fetch ou create)
 *  - save user message
 *  - fetch context (messages, memories, agents) + RAG
 *  - execute agent actions
 *
 * Retorna `{ ok: true, ctx }` ou `{ ok: false, error }` para o caller
 * responder.
 */
async function prepareChatContext(request: Request, requestId: string, logger: Logger): Promise<
  { ok: true; ctx: ChatContext } | { ok: false; error: PrepError }
> {
  if (!hasSupabaseEnv()) {
    return { ok: false, error: { status: 503, error: "Supabase não configurado.", code: "supabase_not_configured" } };
  }
  if (!hasAiEnv()) {
    return {
      ok: false,
      error: {
        status: 503,
        error:
          "IA não configurada. Defina AI_API_KEY, OPENAI_API_KEY ou OPENROUTER_API_KEY em .env.local.",
        code: "ai_not_configured",
      },
    };
  }

  const parsed = ChatRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        status: 400,
        error: parsed.error.issues[0]?.message || "Entrada inválida.",
        code: "validation_failed",
        details: { issues: parsed.error.issues },
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: { status: 401, error: "Sessão expirada. Entre novamente.", code: "auth_expired" } };
  }

  // Rate limit por usuario.
  const perMinute = await consumeRateLimit(`chat:user:${user.id}`, env.chatRateLimitPerMinute, ONE_MINUTE_MS);
  if (!perMinute.allowed) {
    return {
      ok: false,
      error: {
        status: 429,
        error: "Muitas mensagens em pouco tempo. Aguarde um instante.",
        code: "rate_limited_per_minute",
        details: { retryAfterSec: Math.ceil(perMinute.resetMs / 1000) },
      },
    };
  }
  const perDay = await consumeRateLimit(`chat:user:${user.id}:day`, env.chatRateLimitPerDay, ONE_DAY_MS);
  if (!perDay.allowed) {
    return {
      ok: false,
      error: {
        status: 429,
        error: "Limite diario de mensagens atingido.",
        code: "rate_limited_per_day",
        details: { retryAfterSec: Math.ceil(perDay.resetMs / 1000) },
      },
    };
  }

  const { message, model, attachments = [] } = parsed.data;
  let effectiveMessage = message;
  let conversationId = parsed.data.conversationId;
  let conversationSummary: string | null = null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("preferences")
    .eq("id", user.id)
    .single();
  const userPreferences = parseUserPreferences(profile?.preferences);

  let preparedAttachments: PreparedAttachment[] = [];
  try {
    preparedAttachments = attachments.length ? await prepareAttachments(supabase, user.id, attachments) : [];
  } catch (err) {
    logger.warn("chat.attachments.prepareFailed", { error: err instanceof Error ? err.message : String(err) });
    return {
      ok: false,
      error: { status: 400, error: "Não foi possível preparar os anexos enviados.", code: "attachments_invalid" },
    };
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
    return {
      ok: false,
      error: {
        status: 400,
        error:
          failedAudioTranscriptions[0]?.transcriptionError ||
          "Recebi seu áudio, mas não consegui transcrever agora. Tente reenviar ou envie um arquivo menor.",
        code: "audio_transcription_failed",
      },
    };
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

  const usedModel = resolveRuntimeModel(model || userPreferences.preferredModel || undefined, webSearch);

  if (conversationId) {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("id, summary")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();
    if (error || !conversation) {
      return { ok: false, error: { status: 404, error: "Conversa não encontrada.", code: "conversation_not_found" } };
    }
    conversationSummary = conversation.summary;
  } else {
    const { data: conversation, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: truncateTitle(effectiveMessage) })
      .select("id, summary")
      .single();
    if (error || !conversation) {
      logger.error("chat.conversation.createFailed", { supabaseError: error?.message });
      return { ok: false, error: { status: 500, error: "Não foi possível criar a conversa.", code: "conversation_create_failed" } };
    }
    conversationId = conversation.id;
    conversationSummary = conversation.summary;
  }

  // Narrowed: conversationId is guaranteed non-undefined here.
  // (assigned in both branches of the if/else above; TS nao narrowing por causa do let).
  const finalConversationId = conversationId as string;

  // Context (messages, memories, agents) carregado em paralelo.
  const contextPromise = Promise.all([
    supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", finalConversationId)
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
      conversation_id: finalConversationId,
      user_id: user.id,
      role: "user",
      content: effectiveMessage,
    })
    .select("id")
    .single();

  if (userMessageError || !userMessage) {
    return { ok: false, error: { status: 500, error: "Não foi possível salvar sua mensagem.", code: "user_message_save_failed" } };
  }

  if (attachments.length) {
    const { error: attachmentInsertError } = await supabase.from("message_attachments").insert(
      attachments.map((attachment) => ({
        message_id: userMessage.id,
        conversation_id: finalConversationId,
        user_id: user.id,
        bucket_id: CHAT_ATTACHMENTS_BUCKET,
        storage_path: attachment.storage_path,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
      })),
    );
    if (attachmentInsertError) {
      return { ok: false, error: { status: 500, error: "Não foi possível salvar os anexos da mensagem.", code: "attachments_save_failed" } };
    }
  }

  const actionResults = await executeAgentActions({ supabase, user, message: effectiveMessage });

  // RAG: tenta busca por similaridade vetorial. Se falhar, cai para
  // busca por prioridade.
  const [recentMessagesResult, agentsResult] = await contextPromise;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentRows = (agentsResult.data || []) as any[];
  const activeAgent = userPreferences.activeAgentId
    ? agentRows.find((agent) => agent.id === userPreferences.activeAgentId)
    : null;
  const orderedAgents = activeAgent
    ? [activeAgent, ...agentRows.filter((agent) => agent.id !== activeAgent.id)]
    : agentRows;

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
      logger.warn("chat.ragUnavailable", { error: err instanceof Error ? err.message : String(err) });
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

  return {
    ok: true,
    ctx: {
      requestId,
      logger,
      supabase,
      user,
      conversationId: finalConversationId,
      userMessageId: userMessage.id,
      effectiveMessage,
      webSearch,
      usedModel,
      userPreferences,
      orderedAgents: orderedAgents as unknown as ChatContext["orderedAgents"],
      knowledgeData,
      actionResults: actionResults as unknown as ChatContext["actionResults"],
      recentMessages: (((recentMessagesResult.data || []).reverse() as BrainMessage[])).concat({ role: "user", content: effectiveMessage }),
      attachments,
      preparedAttachments,
      audioTranscriptions,
      audioResponseIntro,
      model,
      conversationSummary,
    },
  };
}

function buildBrainInput(ctx: ChatContext) {
  const requestedModel = ctx.model || ctx.orderedAgents[0]?.model || ctx.userPreferences.preferredModel || undefined;
  return {
    userMessage: ctx.effectiveMessage,
    conversationSummary: ctx.conversationSummary,
    model: requestedModel || undefined,
    webSearch: ctx.webSearch,
    attachments: ctx.preparedAttachments,
    actionResults: ctx.actionResults.results,
    memories: ctx.userPreferences.memoryMode === "off" ? [] : ((({ data: [] } as unknown) as { data: Memory[] }).data || []),
    knowledge: ctx.knowledgeData,
    agents: ctx.orderedAgents as unknown as Parameters<typeof runBrain>[0]["agents"],
    activeAgentId: ctx.orderedAgents[0]?.id || "",
    recentMessages: ctx.recentMessages,
    userPreferences: ctx.userPreferences,
  };
}

async function saveAssistantAndScheduleLearning(
  ctx: ChatContext,
  assistantMessage: string,
  actualUsedModel: string,
  fallbackUsed: boolean,
  modelAttempts: RunBrainOutput["attempts"],
) {
  if (!assistantMessage) {
    assistantMessage = "Não consegui gerar uma resposta útil agora. Pode reformular sua mensagem?";
  }
  if (ctx.audioResponseIntro) {
    assistantMessage = `${ctx.audioResponseIntro}\n\n${assistantMessage}`;
  }

  const { error: assistantMessageError } = await ctx.supabase.from("messages").insert({
    conversation_id: ctx.conversationId,
    user_id: ctx.user.id,
    role: "assistant",
    content: assistantMessage,
  });
  if (assistantMessageError) {
    ctx.logger.error("chat.assistantMessage.saveFailed", { error: assistantMessageError.message });
    // Continua o response ao usuario mesmo assim — ele tem a resposta;
    // o problema e de persistencia e sera logado.
  }

  const shouldRunLearning = ctx.userPreferences.memoryMode === "auto" && shouldLearnFromMessage(ctx.effectiveMessage);

  after(async () => {
    await ctx.supabase.from("agent_logs").insert({
      user_id: ctx.user.id,
      conversation_id: ctx.conversationId,
      level: "success",
      message: `Resposta gerada${ctx.webSearch ? " com busca web" : ""}.`,
      metadata: {
        model: ctx.model,
        used_model: actualUsedModel,
        provider: env.aiProvider,
        web_search: ctx.webSearch,
        attachment_count: ctx.attachments.length,
        audio_transcriptions: ctx.audioTranscriptions.length,
        action_results: ctx.actionResults.results,
        agent_steps: ctx.actionResults.steps,
        fallback_used: fallbackUsed,
        model_attempts: modelAttempts,
        fast_mode: env.aiFastMode,
      },
    });

    if (!shouldRunLearning) {
      await ctx.supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", ctx.conversationId)
        .eq("user_id", ctx.user.id);
      return;
    }

    const brainUpdates = await extractBrainUpdates({
      userMessage: ctx.effectiveMessage,
      assistantMessage,
      previousSummary: ctx.conversationSummary,
      model: actualUsedModel,
    });

    if (brainUpdates.summary) {
      await ctx.supabase
        .from("conversations")
        .update({ summary: brainUpdates.summary, updated_at: new Date().toISOString() })
        .eq("id", ctx.conversationId)
        .eq("user_id", ctx.user.id);
    } else {
      await ctx.supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", ctx.conversationId)
        .eq("user_id", ctx.user.id);
    }

    if (brainUpdates.memories.length) {
      await ctx.supabase.from("memories").insert(
        brainUpdates.memories.map((memory) => ({
          user_id: ctx.user.id,
          kind: memory.kind,
          content: memory.content,
          confidence: memory.confidence,
          source_conversation_id: ctx.conversationId,
        })),
      );
    }
  });
}

function errorResponse(prep: PrepError, requestId: string) {
  const response = jsonError(prep.error, {
    status: prep.status,
    requestId,
    code: prep.code,
    details: prep.details,
  });
  if (prep.code === "rate_limited_per_minute" || prep.code === "rate_limited_per_day") {
    const retryAfter = (prep.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
    if (retryAfter) {
      response.headers.set("Retry-After", String(retryAfter));
    }
  }
  return response;
}

function ndjsonEncode(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

export async function POST(request: Request) {
  const requestId = extractOrCreateRequestId(request);
  const logger = createLogger("chat", requestId);
  logger.info("chat.received", {
    messageBytes: request.headers.get("content-length") ?? "unknown",
  });

  // Parse inicial para detectar `stream` antes do prep completo.
  // Fazemos um parse minimo aqui; o prep faz o parse completo novamente
  // para validar tudo. Pequena duplicacao, mas o prep so roda se
  // passarmos essa verificacao basica.
  const rawBody = await request.json().catch(() => null);
  const streamRequested = Boolean((rawBody as { stream?: boolean } | null)?.stream);

  // Para o path streaming, ainda fazemos o prep completo — so depois
  // decidimos como serializar a response.
  const prep = await prepareChatContext(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      // Re-constroi o body ja lido, se houver. Se a prep precisar de algo
      // que ainda nao lemos, ela fara o seu proprio parse.
      body: rawBody !== null ? JSON.stringify(rawBody) : null,
    }),
    requestId,
    logger,
  );

  if (!prep.ok) {
    return errorResponse(prep.error, requestId);
  }

  const ctx = prep.ctx;

  // PATH: streaming (NDJSON)
  if (streamRequested) {
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Header event: meta com conversationId, requestId, usedModel.
        controller.enqueue(
          ndjsonEncode({
            type: "meta",
            requestId,
            conversationId: ctx.conversationId,
            userMessageId: ctx.userMessageId,
            usedModel: ctx.usedModel,
            webSearch: ctx.webSearch,
            provider: env.aiProvider,
          }),
        );

        const brainInput = buildBrainInput(ctx);
        let accumulatedText = "";
        let actualUsedModel = ctx.usedModel;
        let fallbackUsed = false;
        let modelAttempts: RunBrainOutput["attempts"] = [];

        try {
          for await (const event of runBrainStream(brainInput)) {
            if (event.type === "delta") {
              accumulatedText += event.text;
              controller.enqueue(ndjsonEncode({ type: "delta", text: event.text, model: event.model }));
              actualUsedModel = event.model;
            } else if (event.type === "model") {
              modelAttempts.push({ model: event.model, status: event.status, error: event.error });
            } else if (event.type === "done") {
              actualUsedModel = event.usedModel;
              fallbackUsed = event.fallbackUsed;
              modelAttempts = event.attempts;
            } else if (event.type === "error") {
              logger.error("chat.brain.allModelsFailed", { message: event.message });
              await ctx.supabase.from("agent_logs").insert({
                user_id: ctx.user.id,
                conversation_id: ctx.conversationId,
                level: "error",
                message: "Falha ao executar o cérebro de IA.",
                metadata: { model: ctx.model, used_model: actualUsedModel, web_search: ctx.webSearch },
              });
              controller.enqueue(
                ndjsonEncode({
                  type: "error",
                  code: "all_models_failed",
                  message: "A IA não conseguiu responder agora. Verifique provedor, chave e modelo.",
                }),
              );
              controller.close();
              return;
            }
          }

          // Salva a mensagem do assistente e agenda learning.
          await saveAssistantAndScheduleLearning(
            ctx,
            accumulatedText,
            actualUsedModel,
            fallbackUsed,
            modelAttempts,
          );

          controller.enqueue(
            ndjsonEncode({
              type: "done",
              usedModel: actualUsedModel,
              provider: env.aiProvider,
              webSearch: ctx.webSearch,
              fallbackUsed,
              modelAttempts,
              actionResults: ctx.actionResults.results,
              agentSteps: ctx.actionResults.steps,
            }),
          );

          logger.info("chat.stream.completed", {
            conversationId: ctx.conversationId,
            model: actualUsedModel,
            fallbackUsed,
            attachmentCount: ctx.attachments.length,
          });
        } catch (err) {
          logger.error("chat.stream.error", {
            error: err instanceof Error ? err.message : String(err),
            name: err instanceof Error ? err.name : undefined,
          });
          controller.enqueue(
            ndjsonEncode({
              type: "error",
              code: "stream_interrupted",
              message: "A stream foi interrompida.",
            }),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "x-request-id": requestId,
      },
    });
  }

  // PATH: non-streaming (legado, JSON)
  const brainInput = buildBrainInput(ctx);
  let assistantMessage: string;
  let actualUsedModel = ctx.usedModel;
  let fallbackUsed = false;
  let modelAttempts: RunBrainOutput["attempts"] = [];
  try {
    const brainResult = await runBrain(brainInput);
    assistantMessage = brainResult.text;
    actualUsedModel = brainResult.usedModel;
    fallbackUsed = brainResult.fallbackUsed;
    modelAttempts = brainResult.attempts;
  } catch (err) {
    logger.error("chat.brain.error", { error: err instanceof Error ? err.message : String(err) });
    await ctx.supabase.from("agent_logs").insert({
      user_id: ctx.user.id,
      conversation_id: ctx.conversationId,
      level: "error",
      message: "Falha ao executar o cérebro de IA.",
      metadata: {
        model: ctx.model,
        used_model: actualUsedModel,
        web_search: ctx.webSearch,
        attachment_count: ctx.attachments.length,
        audio_transcriptions: ctx.audioTranscriptions.length,
        action_results: ctx.actionResults.results,
        agent_steps: ctx.actionResults.steps,
        model_attempts: modelAttempts,
      },
    });
    return jsonError("A IA não conseguiu responder agora. Verifique provedor, chave e modelo.", {
      status: 502,
      requestId,
      code: "all_models_failed",
    });
  }

  await saveAssistantAndScheduleLearning(ctx, assistantMessage, actualUsedModel, fallbackUsed, modelAttempts);

  logger.info("chat.completed", {
    conversationId: ctx.conversationId,
    model: actualUsedModel,
    fallbackUsed,
    webSearch: ctx.webSearch,
    attachmentCount: ctx.attachments.length,
  });

  return jsonResult(true, {
    conversationId: ctx.conversationId,
    assistantMessage,
    model: actualUsedModel || ctx.model || ctx.userPreferences.preferredModel || env.aiModel,
    usedModel: actualUsedModel,
    provider: env.aiProvider,
    webSearch: ctx.webSearch,
    fallbackUsed,
    modelAttempts,
    actionResults: ctx.actionResults.results,
    agentSteps: ctx.actionResults.steps,
  }, { requestId });
}

// Tipos exportados para testes.
export type { ChatContext, PrepError };
export { prepareChatContext, errorResponse, ndjsonEncode };
