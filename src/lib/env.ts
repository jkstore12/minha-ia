export type AiProvider = "openai" | "openrouter" | "custom";

function normalizeProvider(value: string | undefined): AiProvider {
  if (value === "openrouter" || value === "custom" || value === "openai") {
    return value;
  }

  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  return "openai";
}

const aiProvider = normalizeProvider(process.env.AI_PROVIDER?.toLowerCase());
const aiApiKey =
  process.env.AI_API_KEY ||
  (aiProvider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY) ||
  process.env.OPENAI_API_KEY ||
  process.env.OPENROUTER_API_KEY;

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (!value) return defaultValue;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function parseNumber(value: string | undefined, defaultValue: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

function parseList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultBaseUrl(provider: AiProvider) {
  if (provider === "openrouter") return "https://openrouter.ai/api/v1";
  return undefined;
}

function defaultModel(provider: AiProvider) {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  if (provider === "openrouter") return "openai/gpt-5.4-mini";
  return "gpt-5.4-mini";
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  aiProvider,
  aiApiKey,
  aiBaseUrl: process.env.AI_BASE_URL || defaultBaseUrl(aiProvider),
  aiModel: defaultModel(aiProvider),
  aiFallbackModels: parseList(process.env.AI_FALLBACK_MODELS),
  aiTemperature: parseNumber(process.env.AI_TEMPERATURE, 0.4, 0, 2),
  aiMaxTokens: parseNumber(process.env.AI_MAX_TOKENS, 4096, 256, 128000),
  aiFastMode: parseBoolean(process.env.AI_FAST_MODE, true),
  aiAutoLearning: parseBoolean(process.env.AI_AUTO_LEARNING, true),
  audioTranscriptionEnabled: parseBoolean(process.env.AUDIO_TRANSCRIPTION_ENABLED, true),
  audioTranscriptionApiKey:
    process.env.AUDIO_TRANSCRIPTION_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.AI_API_KEY,
  audioTranscriptionBaseUrl:
    process.env.AUDIO_TRANSCRIPTION_BASE_URL ||
    "https://openrouter.ai/api/v1",
  audioTranscriptionModel: process.env.AUDIO_TRANSCRIPTION_MODEL || "openai/whisper-large-v3",
  webSearchEnabled: parseBoolean(process.env.WEB_SEARCH_ENABLED, true),
  // Rate limit do /api/chat. Padroes: 20 req/min, 300 req/dia por usuario.
  // Em prod multi-instancia, substituir o backend in-memory por Upstash/Redis.
  chatRateLimitPerMinute: parseNumber(process.env.CHAT_RATE_LIMIT_PER_MIN, 20, 1, 1000),
  chatRateLimitPerDay: parseNumber(process.env.CHAT_RATE_LIMIT_PER_DAY, 300, 1, 100000),
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  appName: process.env.APP_NAME || "Minha IA",
  adminEmails: parseList(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL),
};

export function hasSupabaseEnv() {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export function hasAiEnv() {
  return Boolean(env.aiApiKey && env.aiModel);
}

export function requireSupabaseEnv() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase não configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return {
    url: env.supabaseUrl,
    anonKey: env.supabaseAnonKey,
  };
}

export function requireAiEnv() {
  if (!env.aiApiKey) {
    throw new Error("IA não configurada. Defina AI_API_KEY, OPENAI_API_KEY ou OPENROUTER_API_KEY.");
  }

  return {
    apiKey: env.aiApiKey,
    baseUrl: env.aiBaseUrl,
    model: env.aiModel,
    provider: env.aiProvider,
    fallbackModels: env.aiFallbackModels,
    temperature: env.aiTemperature,
    maxTokens: env.aiMaxTokens,
  };
}

export function getSetupStatus() {
  return {
    supabase: {
      configured: hasSupabaseEnv(),
      missing: [
        !env.supabaseUrl ? "NEXT_PUBLIC_SUPABASE_URL" : null,
        !env.supabaseAnonKey ? "NEXT_PUBLIC_SUPABASE_ANON_KEY" : null,
      ].filter(Boolean) as string[],
    },
    ai: {
      configured: hasAiEnv(),
      provider: env.aiProvider,
      model: env.aiModel,
      baseUrl: env.aiBaseUrl,
      missing: [!env.aiApiKey ? "AI_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY" : null].filter(Boolean) as string[],
      webSearch: env.webSearchEnabled && env.aiProvider === "openrouter",
      temperature: env.aiTemperature,
      maxTokens: env.aiMaxTokens,
      fallbackModels: env.aiFallbackModels,
      fastMode: env.aiFastMode,
      autoLearning: env.aiAutoLearning,
      audioTranscription: {
        configured: Boolean(env.audioTranscriptionEnabled && env.audioTranscriptionApiKey),
        enabled: env.audioTranscriptionEnabled,
        model: env.audioTranscriptionModel,
        missing: env.audioTranscriptionEnabled && !env.audioTranscriptionApiKey
          ? ["AUDIO_TRANSCRIPTION_API_KEY ou OPENROUTER_API_KEY"]
          : [],
      },
    },
  };
}
