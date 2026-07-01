import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env, getSetupStatus } from "@/lib/env";

export const runtime = "nodejs";

const DEFAULT_EVOLUTION_API_URL = "https://evolution-api-production-d8ba.up.railway.app";
const HEALTH_TIMEOUT_MS = 5000;

type ServiceStatus = {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  message: string;
  details?: Record<string, string | number | boolean | null>;
};

type DatabaseHealth = {
  checked: boolean;
  reason?: string;
  messageAttachments?: boolean;
  agentKnowledge?: boolean;
  chatAttachmentsBucket?: boolean;
};

function serviceStatus(input: ServiceStatus): ServiceStatus {
  return input;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = HEALTH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

function getAiBaseUrl() {
  if (env.aiBaseUrl) return env.aiBaseUrl.replace(/\/$/, "");
  return "https://api.openai.com/v1";
}

async function checkSupabaseObjects(): Promise<DatabaseHealth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return {
      checked: false,
      reason: "SUPABASE_SERVICE_ROLE_KEY não configurada para diagnostico profundo.",
    };
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [attachments, knowledge, bucket] = await Promise.all([
    supabase.from("message_attachments").select("id", { count: "exact", head: true }),
    supabase.from("agent_knowledge").select("id", { count: "exact", head: true }),
    supabase.storage.getBucket("chat-attachments"),
  ]);

  return {
    checked: true,
    messageAttachments: !attachments.error,
    agentKnowledge: !knowledge.error,
    chatAttachmentsBucket: !bucket.error,
  };
}

async function checkAiProvider(deep: boolean): Promise<ServiceStatus> {
  if (!env.aiApiKey) {
    return serviceStatus({
      id: "ai",
      label: "IA principal",
      status: "error",
      message: "Configure AI_API_KEY, OPENAI_API_KEY ou OPENROUTER_API_KEY.",
      details: { provider: env.aiProvider, model: env.aiModel },
    });
  }

  if (!deep) {
    return serviceStatus({
      id: "ai",
      label: "IA principal",
      status: "ok",
      message: "Chave e modelo configurados.",
      details: { provider: env.aiProvider, model: env.aiModel, tested: false },
    });
  }

  try {
    const response = await fetchWithTimeout(`${getAiBaseUrl()}/models`, {
      headers: {
        Authorization: `Bearer ${env.aiApiKey}`,
        Accept: "application/json",
        ...(env.aiProvider === "openrouter"
          ? {
              "HTTP-Referer": env.appUrl,
              "X-Title": env.appName,
            }
          : {}),
      },
    });

    return serviceStatus({
      id: "ai",
      label: "IA principal",
      status: response.ok ? "ok" : "warning",
      message: response.ok ? "Provedor respondeu ao teste." : `Provedor respondeu HTTP ${response.status}.`,
      details: { provider: env.aiProvider, model: env.aiModel, tested: true },
    });
  } catch (error) {
    return serviceStatus({
      id: "ai",
      label: "IA principal",
      status: "error",
      message: error instanceof Error ? error.message : "Não foi possível testar o provedor de IA.",
      details: { provider: env.aiProvider, model: env.aiModel, tested: true },
    });
  }
}

function checkAudioTranscription(): ServiceStatus {
  const audio = getSetupStatus().ai.audioTranscription;
  if (!audio.enabled) {
    return serviceStatus({
      id: "audio",
      label: "Transcrição de áudio",
      status: "warning",
      message: "Transcrição está desativada por configuração.",
      details: { model: audio.model },
    });
  }

  return serviceStatus({
    id: "audio",
    label: "Transcrição de áudio",
    status: audio.configured ? "ok" : "error",
    message: audio.configured ? "Whisper configurado para áudio." : "Configure OPENROUTER_API_KEY ou AUDIO_TRANSCRIPTION_API_KEY.",
    details: { model: audio.model },
  });
}

async function checkTelegram(deep: boolean): Promise<ServiceStatus> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;

  if (!token) {
    return serviceStatus({
      id: "telegram",
      label: "Telegram",
      status: "warning",
      message: "Bot do Telegram não configurado.",
      details: { ownerConfigured: Boolean(ownerChatId) },
    });
  }

  if (!deep) {
    return serviceStatus({
      id: "telegram",
      label: "Telegram",
      status: ownerChatId ? "ok" : "warning",
      message: ownerChatId ? "Bot e dono configurados." : "Bot configurado, mas o chat do dono não foi definido.",
      details: { ownerConfigured: Boolean(ownerChatId), tested: false },
    });
  }

  try {
    const response = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`);
    const payload = await response.json().catch(() => ({}));
    return serviceStatus({
      id: "telegram",
      label: "Telegram",
      status: response.ok && payload?.ok ? (ownerChatId ? "ok" : "warning") : "error",
      message: response.ok && payload?.ok
        ? ownerChatId
          ? "Telegram respondeu e o dono está configurado."
          : "Telegram respondeu, mas falta TELEGRAM_OWNER_CHAT_ID."
        : "Telegram não respondeu ao teste do bot.",
      details: { ownerConfigured: Boolean(ownerChatId), tested: true },
    });
  } catch (error) {
    return serviceStatus({
      id: "telegram",
      label: "Telegram",
      status: "error",
      message: error instanceof Error ? error.message : "Não foi possível testar o Telegram.",
      details: { ownerConfigured: Boolean(ownerChatId), tested: true },
    });
  }
}

async function checkWhatsApp(deep: boolean): Promise<ServiceStatus> {
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.WHATSAPP_INSTANCE_NAME || "minha-ia";
  const baseUrl = (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_API_URL).replace(/\/$/, "");

  if (!apiKey) {
    return serviceStatus({
      id: "whatsapp",
      label: "WhatsApp",
      status: "warning",
      message: "Evolution API ainda não está configurada.",
      details: { instance },
    });
  }

  if (!deep) {
    return serviceStatus({
      id: "whatsapp",
      label: "WhatsApp",
      status: "ok",
      message: "Evolution API configurada.",
      details: { instance, tested: false },
    });
  }

  try {
    const response = await fetchWithTimeout(`${baseUrl}/instance/connectionState/${encodeURIComponent(instance)}`, {
      headers: {
        apikey: apiKey,
        Accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    const state =
      payload?.instance?.state ||
      payload?.state ||
      payload?.connectionState ||
      payload?.data?.state ||
      payload?.response?.state ||
      "unknown";
    const connected = response.ok && !/close|disconnect|not_configured/i.test(String(state));

    return serviceStatus({
      id: "whatsapp",
      label: "WhatsApp",
      status: connected ? "ok" : "warning",
      message: connected ? "Instância conectada na Evolution API." : `Instância em estado: ${state}.`,
      details: { instance, state: String(state), tested: true },
    });
  } catch (error) {
    return serviceStatus({
      id: "whatsapp",
      label: "WhatsApp",
      status: "error",
      message: error instanceof Error ? error.message : "Não foi possível testar o WhatsApp.",
      details: { instance, tested: true },
    });
  }
}

function checkCron(): ServiceStatus {
  return serviceStatus({
    id: "cron",
    label: "Lembretes automáticos",
    status: process.env.CRON_SECRET ? "ok" : "warning",
    message: process.env.CRON_SECRET
      ? "Endpoint de lembretes protegido e pronto para agendamento."
      : "Configure CRON_SECRET e o Cron da Vercel para disparos automáticos.",
    details: { endpoint: "/api/cron/reminders", protected: Boolean(process.env.CRON_SECRET) },
  });
}

function checkSupabaseService(database: DatabaseHealth): ServiceStatus {
  const setup = getSetupStatus();
  if (!setup.supabase.configured) {
    return serviceStatus({
      id: "supabase",
      label: "Supabase",
      status: "error",
      message: "Configure URL e chave pública do Supabase.",
      details: { checked: false },
    });
  }

  if (!database.checked) {
    return serviceStatus({
      id: "supabase",
      label: "Supabase",
      status: "warning",
      message: "Supabase configurado. Configure service role para diagnóstico completo.",
      details: { checked: false },
    });
  }

  const objectsOk = Boolean(database.messageAttachments && database.agentKnowledge && database.chatAttachmentsBucket);
  return serviceStatus({
    id: "supabase",
    label: "Supabase",
    status: objectsOk ? "ok" : "warning",
    message: objectsOk ? "Banco e Storage essenciais encontrados." : "Alguns objetos essenciais não foram encontrados.",
    details: {
      checked: true,
      messageAttachments: Boolean(database.messageAttachments),
      agentKnowledge: Boolean(database.agentKnowledge),
      chatAttachmentsBucket: Boolean(database.chatAttachmentsBucket),
    },
  });
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  const setup = getSetupStatus();
  const ready = setup.supabase.configured && setup.ai.configured;
  const database: DatabaseHealth = setup.supabase.configured ? await checkSupabaseObjects() : { checked: false };
  const services = await Promise.all([
    Promise.resolve(checkSupabaseService(database)),
    checkAiProvider(deep),
    Promise.resolve(checkAudioTranscription()),
    checkTelegram(deep),
    checkWhatsApp(deep),
    Promise.resolve(checkCron()),
  ]);
  const score = Math.round((services.filter((service) => service.status === "ok").length / services.length) * 100);
  const hasError = services.some((service) => service.status === "error");

  return NextResponse.json(
    {
      ok: ready && !hasError,
      app: "Minha IA",
      checkedAt: new Date().toISOString(),
      deep,
      score,
      setup,
      database,
      services,
    },
    { status: ready ? 200 : 503 },
  );
}
