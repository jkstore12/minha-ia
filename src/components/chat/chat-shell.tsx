"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, BellRing, Bot, Brain, CalendarClock, CheckCircle2, Copy, Database, FileText, Globe2, ImageIcon, Info, KeyRound, Loader2, LogOut, Menu, MessageSquare, MessageSquarePlus, Mic, Paperclip, PlugZap, Search, Send, Settings2, Sparkles, Square, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppLogo } from "@/components/app-logo";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_AUDIO_RECORDING_MS,
  audioExtensionFromMime,
  attachmentDownloadUrl,
  formatFileSize,
  isAudioMime,
  isImageMime,
  type PendingAttachment,
} from "@/lib/chat/attachments";
import { createClient } from "@/lib/supabase/browser";
import type { UserPreferences } from "@/lib/user-preferences";
import { cn } from "@/lib/utils";
import type { Attachment, Conversation, Message } from "@/lib/chat/types";

type AgentStep = {
  id: string;
  label: string;
  status: "completed" | "skipped" | "failed";
  detail?: string;
};

type ChatShellProps = {
  initialConversations: Conversation[];
  initialMessages: Message[];
  initialConversationId?: string;
  userEmail?: string;
  modelName: string;
  providerName: string;
  audioTranscriptionModel: string;
  modelOptions: Array<{ id: string; label: string; description: string }>;
  initialPreferences: UserPreferences;
};

type ChatMessage = Message & {
  model?: string;
  provider?: string;
  web_search?: boolean;
  action_results?: string[];
  agent_steps?: AgentStep[];
  fallback_used?: boolean;
};

type UploadingAttachment = PendingAttachment & {
  localId: string;
  previewUrl?: string;
};

type OpenRouterModelInfo = {
  id: string;
  name: string;
  description: string;
  contextLength: number | null;
  pricing: {
    prompt: string | null;
    completion: string | null;
    request: string | null;
  };
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
};

type RunInfo = {
  model: string;
  usedModel: string;
  provider: string;
  webSearch: boolean;
};

const AGENT_RUN_STAGES = ["Pensando", "Analisando contexto", "Consultando suporte", "Preparando resposta"];
const TOOL_NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/abilities", label: "Habilidades", icon: BellRing },
  { href: "/agents", label: "Agentes", icon: Bot },
  { href: "/tools", label: "Ferramentas", icon: Wrench },
  { href: "/memory", label: "Memória", icon: Database },
  { href: "/scheduler", label: "Agenda", icon: CalendarClock },
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/connectors", label: "Conectores", icon: PlugZap },
  { href: "/settings", label: "Configurações", icon: Settings2 },
  { href: "/setup", label: "Setup", icon: KeyRound },
];

function normalizeModelId(id: string) {
  return id.replace(/:online$/, "");
}

function formatTokens(value: number | null) {
  if (!value) return "não informado";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatPricePerMillion(value: string | null) {
  if (!value) return "não informado";
  const price = Number(value) * 1_000_000;
  if (!Number.isFinite(price)) return "não informado";
  if (price === 0) return "grátis";
  return `US$ ${price.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}/1M`;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function preferredRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
}

function toPendingAttachmentPayload(attachment: UploadingAttachment): PendingAttachment {
  return {
    storage_path: attachment.storage_path,
    file_name: attachment.file_name,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
  };
}

function renderMessageContent(content: string) {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const markdownLabel = match[1];
    const markdownUrl = match[2];
    const plainUrl = match[3];
    const href = markdownUrl || plainUrl;
    const label = markdownLabel || plainUrl;

    parts.push(
      <a
        key={`${href}-${match.index}`}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-blue-700 underline decoration-blue-700/30 underline-offset-4 transition hover:text-blue-900"
      >
        {label}
      </a>,
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length ? parts : content;
}

function ThinkingPanel({ activeStageIndex }: { activeStageIndex: number }) {
  return (
    <div className="mr-auto flex max-w-[92%] items-center gap-3 px-2 py-3 text-sm text-zinc-600">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100">
        <Sparkles className="h-4 w-4 text-zinc-700" />
        <span className="absolute inset-0 animate-ping rounded-full border border-zinc-300" />
      </div>
      <div className="flex items-center gap-2">
        <span>{AGENT_RUN_STAGES[activeStageIndex]}</span>
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.2s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.1s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
        </span>
      </div>
    </div>
  );
}

export function ChatShell({
  initialConversations,
  initialMessages,
  initialConversationId,
  userEmail,
  modelName,
  providerName,
  audioTranscriptionModel,
  modelOptions,
  initialPreferences,
}: ChatShellProps) {
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<BlobPart[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(initialConversationId);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ChatMessage[]>>(
    initialConversationId ? { [initialConversationId]: initialMessages } : {},
  );
  const [input, setInput] = useState("");
  const [preferences, setPreferences] = useState(initialPreferences);
  const [settingsDraft, setSettingsDraft] = useState(initialPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<UploadingAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [micSupported] = useState(
    () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined",
  );
  const [selectedModel, setSelectedModel] = useState(modelName);
  const [openRouterModels, setOpenRouterModels] = useState<Record<string, OpenRouterModelInfo>>({});
  const [lastRunInfo, setLastRunInfo] = useState<RunInfo | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const selectedOption = useMemo(
    () => modelOptions.find((option) => option.id === selectedModel),
    [modelOptions, selectedModel],
  );
  const displayModelLabel = (selectedOption?.label || selectedModel).replace(/^OpenRouter:\s*/, "");
  const selectedModelInfo = openRouterModels[normalizeModelId(selectedModel)];
  const hasPendingImage = pendingAttachments.some((attachment) => isImageMime(attachment.mime_type));
  const hasPendingNonAudioFile = pendingAttachments.some((attachment) => !isAudioMime(attachment.mime_type, attachment.file_name));
  const selectedModalities = selectedModelInfo?.inputModalities || [];
  const mayNeedModelFallback =
    Boolean(selectedModelInfo) &&
    ((hasPendingImage && !selectedModalities.includes("image")) ||
      (hasPendingNonAudioFile && !selectedModalities.some((modality) => modality === "file" || modality === "image")));

  const activeMessages = useMemo(() => {
    if (!activeConversationId) return [];
    return messagesByConversation[activeConversationId] || [];
  }, [activeConversationId, messagesByConversation]);
  const filteredConversations = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(query));
  }, [chatSearch, conversations]);

  useEffect(() => {
    if (!providerName.toLowerCase().includes("openrouter")) return;

    const controller = new AbortController();
    const ids = modelOptions.map((option) => option.id).join(",");

    fetch(`/api/openrouter/models?ids=${encodeURIComponent(ids)}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: OpenRouterModelInfo[] } | null) => {
        if (!payload?.data) return;
        setOpenRouterModels(
          Object.fromEntries(payload.data.map((model) => [model.id, model])),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setOpenRouterModels({});
      });

    return () => controller.abort();
  }, [modelOptions, providerName]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!isSending) return;

    const timer = window.setInterval(() => {
      setActiveStageIndex((current) => Math.min(current + 1, AGENT_RUN_STAGES.length - 1));
    }, 1700);

    return () => window.clearInterval(timer);
  }, [isSending]);

  async function loadConversation(conversationId: string) {
    setError(null);
    setActiveConversationId(conversationId);
    setMobilePanelOpen(false);

    if (messagesByConversation[conversationId]) return;

    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("messages")
      .select("id, conversation_id, role, content, created_at, attachments:message_attachments(id, message_id, conversation_id, storage_path, file_name, mime_type, size_bytes, created_at)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (loadError) {
      setError("Não foi possível carregar esta conversa.");
      return;
    }

    setMessagesByConversation((current) => ({ ...current, [conversationId]: (data || []) as ChatMessage[] }));
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function openSettings() {
    setSettingsDraft({ ...preferences, preferredModel: selectedModel });
    setSettingsOpen(true);
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSettingsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: settingsDraft }),
      });
      const payload = (await response.json()) as { preferences?: UserPreferences; error?: string };
      if (!response.ok || !payload.preferences) {
        throw new Error(payload.error || "Não foi possível salvar as instruções.");
      }

      setPreferences(payload.preferences);
      if (payload.preferences.preferredModel) setSelectedModel(payload.preferences.preferredModel);
      setSettingsOpen(false);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Não foi possível salvar as instruções.");
    } finally {
      setSettingsSaving(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const availableSlots = MAX_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length;
    const selectedFiles = Array.from(files).slice(0, Math.max(availableSlots, 0));
    if (!selectedFiles.length) return;

    setError(null);
    setIsUploading(true);

    try {
      const uploaded: UploadingAttachment[] = [];

      for (const file of selectedFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/attachments", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as PendingAttachment & { error?: string };

        if (!response.ok || !payload.storage_path) {
          throw new Error(payload.error || `Não foi possível enviar ${file.name}.`);
        }

        uploaded.push({
          ...payload,
          localId: crypto.randomUUID(),
          previewUrl: isImageMime(payload.mime_type) || isAudioMime(payload.mime_type, payload.file_name) ? URL.createObjectURL(file) : undefined,
        });
      }

      setPendingAttachments((current) => [...current, ...uploaded]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar o arquivo.");
    } finally {
      setIsUploading(false);
    }
  }

  function stopRecordingTimer() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function stopRecordingStream() {
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderStreamRef.current = null;
  }

  async function startVoiceRecording() {
    if (isRecording || isUploading || !micSupported) return;

    if (pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      setError(`Limite de ${MAX_ATTACHMENTS_PER_MESSAGE} anexos por mensagem atingido.`);
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderChunksRef.current = [];
      recorderStreamRef.current = stream;
      recorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recorderChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stopRecordingTimer();
        stopRecordingStream();
        setIsRecording(false);

        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recorderChunksRef.current, { type: recordedMimeType });
        recorderChunksRef.current = [];
        recorderRef.current = null;

        if (!blob.size) {
          setError("Não consegui capturar áudio. Tente gravar novamente.");
          setRecordingMs(0);
          return;
        }

        const extension = audioExtensionFromMime(recordedMimeType);
        const file = new File([blob], `voz-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, {
          type: recordedMimeType,
        });
        setRecordingMs(0);
        void uploadFiles([file]);
      };

      recorder.start(1000);
      setIsRecording(true);
      setRecordingMs(0);
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - recordingStartedAtRef.current;
        setRecordingMs(elapsed);
        if (elapsed >= MAX_AUDIO_RECORDING_MS) {
          stopVoiceRecording();
        }
      }, 250);
    } catch (recordingError) {
      stopRecordingTimer();
      stopRecordingStream();
      setIsRecording(false);
      setError(recordingError instanceof Error ? recordingError.message : "Não foi possível acessar o microfone.");
    }
  }

  function stopVoiceRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }

  function cancelVoiceRecording() {
    const recorder = recorderRef.current;
    recorderChunksRef.current = [];
    recorderRef.current = null;
    stopRecordingTimer();
    stopRecordingStream();
    setIsRecording(false);
    setRecordingMs(0);

    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
  }

  function removePendingAttachment(localId: string) {
    setPendingAttachments((current) => {
      const removed = current.find((attachment) => attachment.localId === localId);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((attachment) => attachment.localId !== localId);
    });
  }

  async function copyMessage(message: ChatMessage) {
    await navigator.clipboard.writeText(message.content);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId(null), 1800);
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if ((!message && !pendingAttachments.length) || isSending || isUploading) return;

    setInput("");
    const attachmentsForMessage = pendingAttachments;
    setPendingAttachments([]);
    setError(null);
    setActiveStageIndex(0);
    setIsSending(true);

    const optimisticConversationId = activeConversationId || "pending";
    const onlyAudio = attachmentsForMessage.length > 0 && attachmentsForMessage.every((attachment) => isAudioMime(attachment.mime_type, attachment.file_name));
    const fallbackMessage = onlyAudio ? "Áudio enviado." : "Arquivo enviado.";
    const requestMessage = message || (onlyAudio ? "Transcreva e responda ao áudio enviado." : "Analise os arquivos anexados.");
    const optimisticUserMessage: Message = {
      id: crypto.randomUUID(),
      conversation_id: optimisticConversationId,
      role: "user",
      content: message || fallbackMessage,
      created_at: new Date().toISOString(),
      attachments: attachmentsForMessage.map(toPendingAttachmentPayload),
    };

    setMessagesByConversation((current) => ({
      ...current,
      [optimisticConversationId]: [...(current[optimisticConversationId] || []), optimisticUserMessage],
    }));

    // Mensagem otimista do assistente: vazia, sera preenchida incrementalmente
    // com cada { type: "delta" } da NDJSON stream.
    const streamingAssistantId = crypto.randomUUID();
    const streamingAssistant: ChatMessage = {
      id: streamingAssistantId,
      conversation_id: optimisticConversationId,
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    setMessagesByConversation((current) => ({
      ...current,
      [optimisticConversationId]: [
        ...(current[optimisticConversationId] || []),
        streamingAssistant,
      ],
    }));

    // AbortController permite ao usuario cancelar a geracao (futuro).
    const abortController = new AbortController();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          conversationId: activeConversationId,
          message: requestMessage,
          model: selectedModel,
          stream: true, // opt-in para NDJSON streaming
          attachments: attachmentsForMessage.map(toPendingAttachmentPayload),
        }),
      });

      if (!response.ok) {
        // Erro HTTP antes do stream comecar. Tenta parsear jsonError.
        const errPayload = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        throw new Error(errPayload.error || "Não foi possível responder.");
      }

      if (!response.body) {
        throw new Error("Resposta sem corpo.");
      }

      // Stream NDJSON: cada linha e um JSON { type, ... }.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let returnedConversationId = optimisticConversationId;
      let streamDone: {
        usedModel?: string;
        provider?: string;
        webSearch?: boolean;
        fallbackUsed?: boolean;
        modelAttempts?: Array<{ model: string; status: "success" | "error"; error?: string }>;
        actionResults?: string[];
        agentSteps?: AgentStep[];
      } = {
        usedModel: undefined,
        provider: undefined,
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Processa linhas completas (terminadas em \n).
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // a ultima pode ser parcial

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: {
            type: "meta" | "delta" | "model" | "done" | "error";
            [k: string]: unknown;
          };
          try {
            event = JSON.parse(line);
          } catch {
            continue; // linha malformada, ignora
          }

          if (event.type === "meta") {
            returnedConversationId = String(event.conversationId || optimisticConversationId);
            // Atualiza a mensagem otimista com o conversationId real.
            setMessagesByConversation((current) => ({
              ...current,
              [returnedConversationId]: (current[optimisticConversationId] || []).map((m) =>
                m.id === streamingAssistantId
                  ? { ...m, conversation_id: returnedConversationId }
                  : m,
              ),
            }));
          } else if (event.type === "delta") {
            accumulated += String(event.text || "");
            // Atualiza a UI com o texto parcial. Limitamos updates para
            // evitar 60 fps render loop com 1000 tokens.
            setMessagesByConversation((current) => {
              const list = current[returnedConversationId] || current[optimisticConversationId] || [];
              return {
                ...current,
                [returnedConversationId]: list.map((m) =>
                  m.id === streamingAssistantId ? { ...m, content: accumulated } : m,
                ),
              };
            });
            // Auto-scroll enquanto o texto cresce.
            window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "auto" }), 0);
          } else if (event.type === "done") {
            streamDone = event as typeof streamDone;
          } else if (event.type === "error") {
            throw new Error(String(event.message || "Erro durante a geracao."));
          }
        }
      }

      // Evento "done" esperado como terminal.
      if (!streamDone) {
        throw new Error("Stream terminou sem evento 'done'.");
      }

      // Finaliza a mensagem com metadata.
      const finalAssistant: ChatMessage = {
        id: streamingAssistantId,
        conversation_id: returnedConversationId,
        role: "assistant",
        content: accumulated,
        created_at: new Date().toISOString(),
        model: streamDone.usedModel,
        provider: streamDone.provider,
        web_search: streamDone.webSearch,
        fallback_used: streamDone.fallbackUsed,
        action_results: streamDone.actionResults,
        agent_steps: streamDone.agentSteps,
      };
      setMessagesByConversation((current) => {
        const list = current[returnedConversationId] || current[optimisticConversationId] || [];
        return {
          ...current,
          [returnedConversationId]: list.map((m) => (m.id === streamingAssistantId ? finalAssistant : m)),
        };
      });

      if (streamDone.usedModel && streamDone.provider) {
        setLastRunInfo({
          model: selectedModel,
          usedModel: streamDone.usedModel,
          provider: streamDone.provider,
          webSearch: Boolean(streamDone.webSearch),
        });
      }

      setActiveConversationId(returnedConversationId);
      if (!activeConversationId) {
        setConversations((current) => [
          {
            id: returnedConversationId,
            title: message.length > 64 ? `${message.slice(0, 63)}...` : message || fallbackMessage,
            summary: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          ...current,
        ]);
      }

      attachmentsForMessage.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 50);
    } catch (sendError) {
      const errorMessage = sendError instanceof Error ? sendError.message : "Não foi possível enviar.";
      setError(errorMessage);
      setPendingAttachments(attachmentsForMessage);
      // Remove a mensagem otimista vazia do assistente em caso de erro.
      setMessagesByConversation((current) => {
        const list = current[optimisticConversationId] || [];
        return {
          ...current,
          [optimisticConversationId]: list.filter((m) => m.id !== streamingAssistantId),
        };
      });
    } finally {
      setIsSending(false);
      setActiveStageIndex(0);
    }
  }

  const visibleMessages = activeConversationId ? activeMessages : messagesByConversation.pending || [];

  function renderAttachments(attachments?: Attachment[] | PendingAttachment[]) {
    if (!attachments?.length) return null;

    return (
      <div className="mt-3 grid gap-2">
        {attachments.map((attachment) => {
          const id = "id" in attachment ? attachment.id : undefined;
          const href = attachmentDownloadUrl(id);
          const preview = id && isImageMime(attachment.mime_type) ? href : "";
          const isAudio = isAudioMime(attachment.mime_type, attachment.file_name);

          if (isAudio) {
            return (
              <div
                key={id || attachment.storage_path}
                className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600"
              >
                <div className="mb-2 flex items-center gap-3">
                  <Mic className="h-5 w-5 shrink-0 text-zinc-500" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-zinc-900">{attachment.file_name}</span>
                    <span className="block text-zinc-500">{attachment.mime_type} - {formatFileSize(attachment.size_bytes)}</span>
                  </span>
                </div>
                {href ? <audio controls src={href} className="h-9 w-full" preload="metadata" /> : null}
              </div>
            );
          }

          return (
            <a
              key={id || attachment.storage_path}
              href={href || undefined}
              target={href ? "_blank" : undefined}
              rel="noreferrer"
              className="flex min-w-0 items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600 transition hover:bg-zinc-100"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={attachment.file_name} className="h-12 w-12 rounded-md object-cover" />
              ) : isImageMime(attachment.mime_type) ? (
                <ImageIcon className="h-5 w-5 shrink-0 text-zinc-500" />
              ) : (
                <FileText className="h-5 w-5 shrink-0 text-zinc-500" />
              )}
              <span className="min-w-0">
                <span className="block truncate font-medium text-zinc-900">{attachment.file_name}</span>
                <span className="block text-zinc-500">{attachment.mime_type} · {formatFileSize(attachment.size_bytes)}</span>
              </span>
            </a>
          );
        })}
      </div>
    );
  }

  function renderSidebarContent(onClose?: () => void) {
    return (
      <div className="flex h-full flex-col bg-white text-zinc-950">
        <div className="flex h-16 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <AppLogo className="h-9 w-9" />
            <div>
              <h1 className="text-sm font-semibold">Minha IA</h1>
              <p className="text-xs text-zinc-500">Orquestrador profissional</p>
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        <div className="shrink-0 space-y-1 px-3">
          <button
            onClick={() => {
              setActiveConversationId(undefined);
              onClose?.();
            }}
            className="flex h-14 w-full items-center gap-3 rounded-xl bg-zinc-100 px-4 text-left text-[15px] font-medium text-zinc-950 transition hover:bg-zinc-200"
          >
            <MessageSquarePlus className="h-5 w-5" />
            Novo chat
          </button>

          <div className="grid grid-cols-3 gap-1.5 pt-2">
            {TOOL_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.href === "/chat";
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 text-center text-[11px] leading-tight transition duration-200 active:scale-[0.98]",
                    active
                      ? "border-zinc-950 bg-zinc-950 text-white shadow-sm"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="line-clamp-2">{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="pt-2">
            <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Conversas</p>
          </div>

          <label className="flex h-12 items-center gap-3 rounded-xl px-4 text-[15px] text-zinc-800 transition focus-within:bg-zinc-100 hover:bg-zinc-100">
            <Search className="h-5 w-5 shrink-0" />
            <input
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-zinc-500"
              placeholder="Buscar chats"
            />
          </label>

          <button
            onClick={() => {
              openSettings();
              onClose?.();
            }}
            className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-[15px] text-zinc-800 transition hover:bg-zinc-100"
          >
            <Settings2 className="h-5 w-5" />
            Instruções da IA
          </button>
        </div>

        <div className="shrink-0 px-4 pt-4">
          <label className="block space-y-2">
            <span className="text-xs font-semibold uppercase text-zinc-500">Modelo</span>
            <select
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400"
            >
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
              <option disabled value="__audio_transcription_model">
                Áudio: Whisper Large V3 - {audioTranscriptionModel}
              </option>
            </select>
            <p className="line-clamp-2 text-xs leading-5 text-zinc-500">
              {selectedOption?.description || selectedModel}
            </p>
          </label>
        </div>

        {preferences.showModelDetails ? (
          <section className="mx-4 mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
            <div className="flex items-start gap-2 text-zinc-900">
              <Info className="mt-0.5 h-4 w-4 text-zinc-500" />
              <div>
                <p className="font-medium">Modelo ativo</p>
                <p className="mt-1 break-all font-mono text-[11px] text-zinc-500">{selectedModel}</p>
              </div>
            </div>
            {selectedModelInfo ? (
              <div className="mt-3 space-y-1">
                <p>Nome: {selectedModelInfo.name}</p>
                <p>Contexto: {formatTokens(selectedModelInfo.contextLength)} tokens</p>
                <p>Entrada: {formatPricePerMillion(selectedModelInfo.pricing.prompt)}</p>
                <p>Saida: {formatPricePerMillion(selectedModelInfo.pricing.completion)}</p>
              </div>
            ) : null}
            <p className="mt-3 text-zinc-500">Áudio automático: {audioTranscriptionModel}</p>
          </section>
        ) : null}

        <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          <p className="px-4 pb-2 text-sm font-semibold text-zinc-950">Recentes</p>
          {filteredConversations.length ? (
            <div className="space-y-1">
              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => {
                    loadConversation(conversation.id);
                    onClose?.();
                  }}
                  className={cn(
                    "block w-full rounded-xl px-4 py-2.5 text-left text-[15px] leading-5 transition",
                    activeConversationId === conversation.id ? "bg-zinc-100 text-zinc-950" : "text-zinc-800 hover:bg-zinc-100",
                  )}
                >
                  <span className="line-clamp-2">{conversation.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl px-4 py-3 text-sm text-zinc-500">
              Nenhuma conversa encontrada.
            </p>
          )}
        </div>

        <div className="border-t border-zinc-200 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-semibold text-white">
              {(userEmail || "MI").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-950">{userEmail || "Usuário"}</p>
              <p className="text-xs text-zinc-500">Minha IA</p>
            </div>
            <button
              onClick={signOut}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
              aria-label="Sair"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="flex h-[100svh] min-h-[100dvh] overflow-hidden bg-white text-zinc-950">
      <aside className="hidden w-80 shrink-0 border-r border-zinc-200 bg-white lg:block">
        {renderSidebarContent()}
      </aside>

      {mobilePanelOpen ? (
        <div className="animate-app-fade fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-black/25"
            onClick={() => setMobilePanelOpen(false)}
          />
          <aside className="animate-slide-in-left relative h-full w-[min(92vw,390px)] border-r border-zinc-200 bg-white shadow-2xl">
            {renderSidebarContent(() => setMobilePanelOpen(false))}
          </aside>
        </div>
      ) : null}

      <section className="animate-app-fade flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 transition-shadow duration-300 lg:h-14 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobilePanelOpen(true)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-700 transition hover:bg-zinc-100 lg:hidden"
              aria-label="Abrir conversas"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-base font-semibold text-zinc-950">Minha IA</p>
              <p className="max-w-[52vw] truncate text-xs text-zinc-500 sm:max-w-none">
                {providerName} / {displayModelLabel}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/abilities"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-700 transition hover:bg-zinc-100 sm:w-auto sm:px-3 lg:hidden"
              aria-label="Abrir habilidades e lembretes"
            >
              <BellRing className="h-5 w-5" />
              <span className="hidden sm:ml-2 sm:inline">Habilidades</span>
            </Link>
            <button onClick={openSettings} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-sm text-zinc-700 transition hover:bg-zinc-100 sm:w-auto sm:px-3">
              <Settings2 className="h-5 w-5" />
              <span className="hidden sm:ml-2 sm:inline">Ajustes</span>
            </button>
          </div>
        </header>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-4 sm:py-5 lg:px-8">
          {visibleMessages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col justify-center text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 text-white">
                <Brain className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Como posso ajudar?</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                Use como seu agente pessoal. Ele conversa, analisa arquivos, pesquisa quando necessario e aprende suas preferências.
              </p>
            </div>
          ) : (
            <div className="animate-app-fade-up mx-auto max-w-3xl space-y-6">
              {visibleMessages.map((message) => (
                <article
                  key={message.id}
                  className={cn(
                    "animate-message-in text-sm leading-6 text-zinc-900",
                    message.role === "user"
                      ? "ml-auto max-w-[88%] rounded-3xl bg-zinc-100 px-4 py-3 sm:max-w-[85%]"
                      : "mr-auto max-w-full px-0 py-1 sm:max-w-[92%] sm:px-2",
                  )}
                >
                  <p className="whitespace-pre-wrap">{renderMessageContent(message.content)}</p>
                  {renderAttachments(message.attachments)}
                  {message.role === "assistant" && message.model ? (
                    <footer className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-zinc-500" />
                        Modelo usado
                      </span>
                      <span className="break-all font-mono text-zinc-500">{message.model}</span>
                      {message.fallback_used ? (
                        <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-amber-800">fallback</span>
                      ) : null}
                      {message.web_search ? (
                        <span className="inline-flex items-center gap-1 text-zinc-600">
                          <Globe2 className="h-3.5 w-3.5" />
                          web
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void copyMessage(message)}
                        className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedMessageId === message.id ? "Copiado" : "Copiar"}
                      </button>
                    </footer>
                  ) : null}
                </article>
              ))}
              {isSending ? (
                <ThinkingPanel activeStageIndex={activeStageIndex} />
              ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-100 bg-white px-3 py-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4">
          {preferences.showModelDetails ? (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-2 text-xs text-zinc-500 max-sm:hidden">
            <span>Modelo ativo:</span>
            <span className="break-all rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-zinc-700">
              {selectedModel}
            </span>
            {lastRunInfo ? (
              <span className="break-all rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-zinc-700">
                ultima: {lastRunInfo.usedModel}
              </span>
            ) : null}
          </div>
          ) : null}
          {pendingAttachments.length ? (
            <div className="mx-auto mb-3 grid max-w-3xl gap-2 sm:grid-cols-2">
              {pendingAttachments.map((attachment) => (
                <div key={attachment.localId} className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-2 text-xs">
                  {attachment.previewUrl ? (
                    isAudioMime(attachment.mime_type, attachment.file_name) ? (
                      <Mic className="h-5 w-5 shrink-0 text-zinc-500" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={attachment.previewUrl} alt={attachment.file_name} className="h-12 w-12 rounded-md object-cover" />
                    )
                  ) : (
                    <FileText className="h-5 w-5 shrink-0 text-zinc-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-900">{attachment.file_name}</p>
                    <p className="text-zinc-500">{formatFileSize(attachment.size_bytes)}</p>
                    {attachment.previewUrl && isAudioMime(attachment.mime_type, attachment.file_name) ? (
                      <audio controls src={attachment.previewUrl} className="mt-2 h-8 w-full" preload="metadata" />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(attachment.localId)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900"
                    aria-label="Remover anexo"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {mayNeedModelFallback ? (
            <p className="mx-auto mb-3 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              O modelo escolhido pode não ler este tipo de anexo. Se precisar, o sistema tenta um modelo compatível automaticamente.
            </p>
          ) : null}
          {isRecording ? (
            <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              <div className="flex min-w-0 items-center gap-3">
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
                  <Mic className="h-4 w-4" />
                  <span className="absolute inset-0 animate-ping rounded-full border border-red-300/40" />
                </span>
                <div className="min-w-0">
                  <p className="font-medium">Gravando áudio</p>
                  <p className="text-xs text-red-700">{formatDuration(recordingMs)} / {formatDuration(MAX_AUDIO_RECORDING_MS)}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={cancelVoiceRecording}
                  className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition hover:bg-red-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={stopVoiceRecording}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-zinc-800"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  Enviar áudio
                </button>
              </div>
            </div>
          ) : null}
          <form onSubmit={sendMessage} className="animate-composer-in mx-auto flex max-w-3xl items-end gap-1 rounded-[1.65rem] border border-zinc-200 bg-white p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-shadow duration-300 focus-within:shadow-[0_12px_36px_rgba(0,0,0,0.12)] sm:gap-2 sm:p-2">
            <label className="inline-flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-700 transition duration-200 hover:bg-zinc-100 active:scale-95 sm:h-11 sm:w-11">
              {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) void uploadFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              disabled={!micSupported || isUploading || isSending}
              className={cn(
                "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95 sm:h-11 sm:w-11",
                isRecording ? "bg-red-500 text-white hover:bg-red-400" : "text-zinc-700 hover:bg-zinc-100",
              )}
              aria-label={isRecording ? "Parar gravação de áudio" : "Gravar áudio de voz"}
              title={micSupported ? "Gravar áudio de voz" : "Microfone indisponível neste navegador"}
            >
              {isRecording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
            </button>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className="h-12 max-h-28 min-h-12 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-3.5 text-base leading-5 text-zinc-950 outline-none placeholder:text-zinc-400 sm:h-11 sm:max-h-32 sm:min-h-11 sm:py-3 sm:text-sm"
              placeholder="Mensagem"
              rows={1}
            />
            <button
              type="submit"
              disabled={isSending || isUploading || (!input.trim() && !pendingAttachments.length)}
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition duration-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 active:scale-95 sm:h-11 sm:w-11"
              aria-label="Enviar mensagem"
            >
              {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </button>
          </form>
          {error ? <p className="mx-auto mt-3 max-w-3xl text-sm text-red-600">{error}</p> : null}
        </div>
      </section>
      {settingsOpen ? (
        <div className="animate-app-fade fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4">
          <form onSubmit={saveSettings} className="animate-sheet-up max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white p-4 text-zinc-950 shadow-2xl sm:rounded-2xl sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Instruções da Minha IA</h2>
                <p className="mt-1 text-sm text-zinc-500">Ajuste o jeito que o agente pensa, responde e guarda contexto para você.</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-zinc-800">Instruções personalizadas</span>
                <textarea
                  value={settingsDraft.customInstructions}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, customInstructions: event.target.value })}
                  className="min-h-32 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  placeholder="Ex: seja direto, sempre traga próximos passos, pergunte quando faltar informação importante..."
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-800">Sobre você</span>
                <textarea
                  value={settingsDraft.aboutUser}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, aboutUser: event.target.value })}
                  className="min-h-28 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  placeholder="Seu trabalho, rotina, preferências e contexto."
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-800">Objetivos atuais</span>
                <textarea
                  value={settingsDraft.goals}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, goals: event.target.value })}
                  className="min-h-28 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400"
                  placeholder="Projetos, metas, prioridades e resultados que você quer."
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-800">Estilo de resposta</span>
                <select
                  value={settingsDraft.responseStyle}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, responseStyle: event.target.value as UserPreferences["responseStyle"] })}
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-400"
                >
                  <option value="direto">Direto</option>
                  <option value="detalhado">Detalhado</option>
                  <option value="criativo">Criativo</option>
                  <option value="tecnico">Técnico</option>
                  <option value="executivo">Executivo</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-800">Tom</span>
                <select
                  value={settingsDraft.responseTone}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, responseTone: event.target.value as UserPreferences["responseTone"] })}
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-400"
                >
                  <option value="profissional">Profissional</option>
                  <option value="amigavel">Amigável</option>
                  <option value="objetivo">Objetivo</option>
                  <option value="didatico">Didático</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-800">Busca na internet</span>
                <select
                  value={settingsDraft.webSearchMode}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, webSearchMode: event.target.value as UserPreferences["webSearchMode"] })}
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-400"
                >
                  <option value="auto">Automática</option>
                  <option value="always">Sempre tentar</option>
                  <option value="off">Desligada</option>
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-zinc-800">Memória</span>
                <select
                  value={settingsDraft.memoryMode}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, memoryMode: event.target.value as UserPreferences["memoryMode"] })}
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-400"
                >
                  <option value="auto">Aprender automaticamente</option>
                  <option value="manual">Usar apenas memórias manuais</option>
                  <option value="off">Não usar memória</option>
                </select>
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-zinc-800">Modelo padrão</span>
                <select
                  value={settingsDraft.preferredModel || selectedModel}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, preferredModel: event.target.value })}
                  className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none focus:border-zinc-400"
                >
                  {modelOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={settingsDraft.showModelDetails}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, showModelDetails: event.target.checked })}
                />
                Mostrar painel técnico do modelo na lateral
              </label>
            </div>

            <div className="sticky bottom-0 -mx-4 mt-5 flex justify-end gap-2 border-t border-zinc-200 bg-white px-4 py-3 sm:-mx-5 sm:px-5">
              <button type="button" onClick={() => setSettingsOpen(false)} className="h-10 rounded-lg px-4 text-sm text-zinc-700 hover:bg-zinc-100">
                Cancelar
              </button>
              <button disabled={settingsSaving} type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Salvar
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
