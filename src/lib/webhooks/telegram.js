const MAX_HISTORY_MESSAGES = 20;
const SESSION_TTL_MS = 1000 * 60 * 60 * 6;
const UPDATE_DEDUPE_TTL_MS = 3000;
const TELEGRAM_PII_KEYS = new Set([
  "body",
  "text",
  "chat_id",
  "chatid",
  "message_id",
  "messageid",
  "from",
  "phone",
  "phonenumber",
  "number",
  "remote_jid",
  "remotejid",
  "sender",
  "first_name",
  "last_name",
  "username",
  "caption",
  "raw_text",
  "content",
  "authorization",
  "apikey",
  "x-api-key",
]);

function telegramRedactPII(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(telegramRedactPII);
  if (typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = TELEGRAM_PII_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : telegramRedactPII(v);
  }
  return out;
}

function telegramLogEmit(level, message, meta) {
  const safe = meta ? telegramRedactPII(meta) : {};
  if (process.env.NODE_ENV === "production") {
    process.stdout.write(JSON.stringify({
      ts: new Date().toISOString(),
      level,
      scope: "telegram-webhook",
      msg: message,
      ...(Object.keys(safe).length ? { meta: safe } : {}),
    }) + "\n");
    return;
  }
  const color = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : "\x1b[34m";
  const reset = "\x1b[0m";
  const metaStr = Object.keys(safe).length ? ` \x1b[2m${JSON.stringify(safe)}\x1b[0m` : "";
  console.log(`${color}${level.toUpperCase().padEnd(5)}${reset} telegram-webhook ${message}${metaStr}`);
}

const telegramLogger = {
  debug() {},
  info: (msg, meta) => telegramLogEmit("info", msg, meta),
  warn: (msg, meta) => telegramLogEmit("warn", msg, meta),
  error: (msg, meta) => telegramLogEmit("error", msg, meta),
};
const MAX_TELEGRAM_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_TELEGRAM_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TELEGRAM_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_TEXT_CHARS = 60_000;
const KNOWLEDGE_CAPTURE_TTL_MS = 10 * 60 * 1000;
const TELEGRAM_API_BASE = "https://api.telegram.org";
const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_WEB_SEARCH_MODEL = "perplexity/sonar";
const WEB_SEARCH_FALLBACK_MODELS = [
  DEFAULT_WEB_SEARCH_MODEL,
  "perplexity/sonar-pro",
  "perplexity/sonar-pro-search",
];
const TELEGRAM_IMAGE_MODELS = ["openai/gpt-4o", "~anthropic/claude-sonnet-latest"];
const TELEGRAM_MODELS = [
  {
    id: "openai/gpt-chat-latest",
    alias: "gpt",
    label: "GPT Chat Latest",
    description: "Padrao geral equilibrado.",
  },
  {
    id: "openai/gpt-4o",
    alias: "gpt4o",
    label: "GPT-4o",
    description: "Modelo com visao para imagens, texto e tarefas gerais.",
  },
  {
    id: "openai/gpt-5.5",
    alias: "gpt55",
    label: "GPT-5.5",
    description: "Raciocinio forte e escrita profissional.",
  },
  {
    id: "deepseek/deepseek-v4-flash:free",
    alias: "deepseek-free",
    label: "DeepSeek V4 Flash Gratis",
    description: "Rapido e economico para uso diario.",
  },
  {
    id: "deepseek/deepseek-v4-flash",
    alias: "deepseek",
    label: "DeepSeek V4 Flash",
    description: "Rapido para produtividade e conversa.",
  },
  {
    id: "anthropic/claude-opus-4.7-fast",
    alias: "opus-fast",
    label: "Claude Opus 4.7 Fast",
    description: "Premium com menor latencia.",
  },
  {
    id: "anthropic/claude-opus-4.7",
    alias: "opus",
    label: "Claude Opus 4.7",
    description: "Análise profunda e escrita exigente.",
  },
  {
    id: "~anthropic/claude-sonnet-latest",
    alias: "sonnet",
    label: "Claude Sonnet Latest",
    description: "Equilibrio entre qualidade e custo.",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    alias: "sonnet46",
    label: "Claude Sonnet 4.6",
    description: "Produtividade, escrita, análise e suporte a visao quando disponível.",
  },
  {
    id: "~anthropic/claude-haiku-latest",
    alias: "haiku",
    label: "Claude Haiku Latest",
    description: "Rapido e economico.",
  },
  {
    id: "qwen/qwen3.6-27b",
    alias: "qwen",
    label: "Qwen 3.6 27B",
    description: "Bom equilibrio para tarefas gerais.",
  },
  {
    id: "inclusionai/ling-2.6-1t",
    alias: "ling",
    label: "Ling 2.6 1T",
    description: "Modelo grande para chat e análise.",
  },
  {
    id: "inclusionai/ring-2.6-1t",
    alias: "ring",
    label: "Ring 2.6 1T",
    description: "Alternativa forte para produtividade.",
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    alias: "nemotron-free",
    label: "Nemotron 3 Nano Free",
    description: "Gratis para testes.",
  },
];
const WELCOME_MESSAGE = [
  "Olá, eu sou a Minha IA.",
  "",
  "Posso conversar com você, organizar ideias, criar lembretes, ajudar em decisões, resumir informações e responder dúvidas de forma direta.",
  "",
  "Me mande uma mensagem do jeito que você falaria comigo no app.",
  "",
  "Comandos:",
  "/modelo - ver modelo ativo",
  "/modelos - listar modelos",
  "/modelo deepseek - trocar modelo",
  "/modelo web - forcar pesquisa web na proxima mensagem",
  "/vincular CODIGO - conectar este Telegram a sua conta do app",
  "/lembrar beber água em 30 minutos - criar lembrete",
  "/lembretes - listar lembretes ativos",
  "/cancelar beber água - cancelar lembrete",
  "ok - confirmar lembrete recebido",
].join("\n");

const sessions = globalThis.__minhaIaTelegramSessions || new Map();
globalThis.__minhaIaTelegramSessions = sessions;
const processedUpdates = globalThis.__minhaIaTelegramProcessedUpdates || new Map();
globalThis.__minhaIaTelegramProcessedUpdates = processedUpdates;

function getOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
}

function getTelegramToken() {
  return process.env.TELEGRAM_BOT_TOKEN;
}

function getModel() {
  return process.env.AI_MODEL || process.env.OPENAI_MODEL || "openai/gpt-chat-latest";
}

function getTelegramFallbackModel() {
  return process.env.TELEGRAM_FALLBACK_MODEL || "openai/gpt-4o-mini";
}

function getSupabaseOwnerConfig() {
  return {
    url: String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    ownerUserId: process.env.WHATSAPP_OWNER_USER_ID || "",
  };
}

function hasPersonalWhatsappReportConfig() {
  const config = getSupabaseOwnerConfig();
  return Boolean(config.url && config.serviceRoleKey && config.ownerUserId);
}

function hasSupabaseServiceConfig() {
  const config = getSupabaseOwnerConfig();
  return Boolean(config.url && config.serviceRoleKey);
}

async function supabaseOwnerGet(path) {
  const config = getSupabaseOwnerConfig();
  if (!hasSupabaseServiceConfig()) return null;

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    telegramLogger.error("telegram personal report supabase error", { status: response.status, payload });
    return null;
  }
  return payload;
}

async function supabaseOwnerPost(path, body) {
  const config = getSupabaseOwnerConfig();
  if (!hasSupabaseServiceConfig()) return null;

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    telegramLogger.error("telegram supabase post error", { status: response.status, payload });
    return null;
  }
  return payload;
}

async function supabaseOwnerPatch(path, body) {
  const config = getSupabaseOwnerConfig();
  if (!hasSupabaseServiceConfig()) return null;

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    telegramLogger.error("telegram supabase patch error", { status: response.status, payload });
    return null;
  }
  return payload;
}

function isTelegramOwnerChat(chatId) {
  const ownerChatId = String(process.env.TELEGRAM_OWNER_CHAT_ID || "").trim();
  return Boolean(ownerChatId && String(chatId) === ownerChatId);
}

function isPersonalSummaryCommand(text) {
  return /^\/resumo(?:\s|$)/i.test(String(text || "").trim());
}

function isPersonalUrgentsCommand(text) {
  return /^\/urgentes(?:\s|$)/i.test(String(text || "").trim());
}

function formatPersonalWhatsappRows(rows, title) {
  if (!Array.isArray(rows) || !rows.length) {
    return `${title}\n\nNada registrado nesse periodo.`;
  }

  const lines = rows.slice(0, 20).map((row, index) => {
    const date = new Date(row.created_at).toLocaleString("pt-BR", {
      timeZone: "America/Fortaleza",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const contact = row.contact_name || row.contact_number || "Contato";
    const content = String(row.content || "").replace(/\s+/g, " ").slice(0, 220);
    const response = row.response_text ? `\nResposta: ${String(row.response_text).replace(/\s+/g, " ").slice(0, 220)}` : "";
    return `${index + 1}. ${contact} - ${row.classification} - ${date}\nMensagem: ${content}${response}`;
  });

  return `${title}\n\n${lines.join("\n\n")}`;
}

function isKnowledgeRegisterCommand(text) {
  return /^\/cadastrar(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function stripKnowledgeRegisterCommand(text) {
  return String(text || "").replace(/^\/cadastrar(?:@\w+)?/i, "").trim();
}

function parseKnowledgeCorrectionCommand(text) {
  const match = String(text || "").trim().match(/^\/corrigir(?:@\w+)?\s+(nome|titulo|título|preço|preço|conteúdo|conteúdo|tipo|tags)\s+(.+)$/i);
  if (!match) return null;
  return { field: normalizeForSearchDetection(match[1]), value: match[2].trim() };
}

function isKnowledgeApproveCommand(text) {
  return /^\/aprovar(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isKnowledgeDiscardCommand(text) {
  return /^\/descartar(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function captureState(preferences, channel) {
  const state = preferences?.knowledgeCapture?.[channel];
  if (!state?.expiresAt || new Date(state.expiresAt).getTime() < Date.now()) return null;
  return state;
}

async function updateOwnerPreferences(nextPartial) {
  if (!hasPersonalWhatsappReportConfig()) return null;
  const config = getSupabaseOwnerConfig();
  return updateUserPreferencesById(config.ownerUserId, nextPartial);
}

async function getUserProfileById(userId) {
  if (!hasSupabaseServiceConfig() || !userId) return null;
  const rows = await supabaseOwnerGet(`user_profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,preferences&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function updateUserPreferencesById(userId, nextPartial) {
  if (!hasSupabaseServiceConfig() || !userId) return null;
  const profile = await getUserProfileById(userId);
  const current = profile?.preferences || {};
  const preferences = { ...current, ...nextPartial };
  const updated = await supabaseOwnerPatch(`user_profiles?id=eq.${encodeURIComponent(userId)}`, {
    preferences,
    updated_at: new Date().toISOString(),
  });
  return Array.isArray(updated) ? updated[0]?.preferences || preferences : preferences;
}

function telegramIntegrationFromPreferences(preferences) {
  return preferences?.telegramIntegration || {};
}

function isTelegramLinkCommand(text) {
  return /^\/vincular(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function parseTelegramLinkCode(text) {
  return String(text || "")
    .replace(/^\/vincular(?:@\w+)?\s*/i, "")
    .trim()
    .toUpperCase();
}

async function listProfilesForTelegramLinking() {
  if (!hasSupabaseServiceConfig()) return [];
  const rows = await supabaseOwnerGet("user_profiles?select=id,display_name,preferences&limit=1000");
  return Array.isArray(rows) ? rows : [];
}

async function resolveTelegramUserContext(chatId) {
  const chat = String(chatId || "");
  const config = getSupabaseOwnerConfig();

  if (!hasSupabaseServiceConfig()) {
    if (isTelegramOwnerChat(chatId) && config.ownerUserId) {
      return { ok: true, userId: config.ownerUserId, isOwner: true, displayName: "Dono", preferences: {}, telegramChatId: chat };
    }
    return { ok: false, error: "Este Telegram ainda não está vinculado. Entre no app, gere um código em Configurações > Telegram pessoal e envie /vincular CODIGO aqui." };
  }

  const profiles = await listProfilesForTelegramLinking();
  const linked = profiles.find((profile) => String(telegramIntegrationFromPreferences(profile.preferences).chatId || "") === chat);
  if (linked?.id) {
    return {
      ok: true,
      userId: linked.id,
      isOwner: String(linked.id) === String(config.ownerUserId || ""),
      displayName: linked.display_name || "Usuário",
      preferences: linked.preferences || {},
      telegramChatId: chat,
    };
  }

  if (isTelegramOwnerChat(chatId) && config.ownerUserId) {
    const owner = profiles.find((profile) => String(profile.id) === String(config.ownerUserId));
    return {
      ok: true,
      userId: config.ownerUserId,
      isOwner: true,
      displayName: owner?.display_name || "Dono",
      preferences: owner?.preferences || {},
      telegramChatId: chat,
    };
  }

  return { ok: false, error: "Este Telegram ainda não está vinculado. Entre no app, gere um código em Configurações > Telegram pessoal e envie /vincular CODIGO aqui." };
}

async function handleTelegramLinkCommand(parsed) {
  if (!hasSupabaseServiceConfig()) {
    return "O vínculo do Telegram precisa da SUPABASE_SERVICE_ROLE_KEY configurada no Vercel.";
  }

  const code = parseTelegramLinkCode(parsed.text);
  if (!code) {
    return [
      "Envie o código gerado no app.",
      "",
      "Exemplo:",
      "/vincular ABCD1234",
      "",
      "No app: Configurações > Telegram pessoal > Gerar código.",
    ].join("\n");
  }

  const profiles = await listProfilesForTelegramLinking();
  const now = Date.now();
  const profile = profiles.find((item) => {
    const integration = telegramIntegrationFromPreferences(item.preferences);
    return (
      String(integration.linkCode || "").toUpperCase() === code &&
      integration.linkCodeExpiresAt &&
      new Date(integration.linkCodeExpiresAt).getTime() > now
    );
  });

  if (!profile?.id) {
    return "Código inválido ou expirado. Gere outro código no app em Configurações > Telegram pessoal.";
  }

  const nextPreferences = {
    ...(profile.preferences || {}),
    telegramIntegration: {
      ...telegramIntegrationFromPreferences(profile.preferences),
      chatId: String(parsed.chatId),
      userName: parsed.userName || "",
      linkedAt: new Date().toISOString(),
      linkCode: "",
      linkCodeExpiresAt: "",
    },
  };

  const updated = await supabaseOwnerPatch(`user_profiles?id=eq.${encodeURIComponent(profile.id)}`, {
    preferences: nextPreferences,
    updated_at: new Date().toISOString(),
  });

  if (!Array.isArray(updated) || !updated.length) {
    return "Não consegui salvar o vínculo agora. Tente gerar outro código no app.";
  }

  return [
    "Telegram vinculado com sucesso.",
    "",
    `Conta: ${profile.display_name || "Usuário"}`,
    "",
    "Agora você pode usar:",
    "/lembrar beber água em 30 minutos",
    "/lembretes",
    "/cancelar beber água",
    "ok",
  ].join("\n");
}

async function loadTelegramKnowledgeRuntime() {
  if (!hasPersonalWhatsappReportConfig()) {
    return { error: "Para cadastrar pelo Telegram, configure SUPABASE_SERVICE_ROLE_KEY e WHATSAPP_OWNER_USER_ID no Vercel." };
  }
  const config = getSupabaseOwnerConfig();
  const rows = await supabaseOwnerGet(`user_profiles?id=eq.${encodeURIComponent(config.ownerUserId)}&select=preferences&limit=1`);
  const preferences = Array.isArray(rows) ? rows[0]?.preferences || {} : {};
  const activeCapture = captureState(preferences, "telegram");
  const agentId = String(
    activeCapture?.agentId ||
      preferences.telegramKnowledgeAgentId ||
      preferences.knowledgeAgentId ||
      preferences.whatsappAgentId ||
      preferences.activeAgentId ||
      "",
  ).trim();
  if (!agentId) return { preferences, error: "Escolha o agente destino dos cadastros na Central de Agentes antes de cadastrar conhecimento pelo Telegram." };

  const agentRows = await supabaseOwnerGet(
    [
      `agents?id=eq.${encodeURIComponent(agentId)}`,
      `user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
      "is_active=eq.true",
      "select=id,name,domain,description,model,temperature,max_tokens",
      "limit=1",
    ].join("&"),
  );
  const agent = Array.isArray(agentRows) ? agentRows[0] || null : null;
  if (!agent) return { preferences, error: "Não encontrei o agente ativo para receber esse cadastro." };
  return { preferences, agent };
}

async function armTelegramKnowledgeCapture(chatId) {
  const runtime = await loadTelegramKnowledgeRuntime();
  if (runtime.error) return runtime.error;
  const current = runtime.preferences || {};
  await updateOwnerPreferences({
    knowledgeCapture: {
      ...(current.knowledgeCapture || {}),
      telegram: {
        agentId: runtime.agent.id,
        chatId: String(chatId),
        expiresAt: new Date(Date.now() + KNOWLEDGE_CAPTURE_TTL_MS).toISOString(),
      },
    },
  });
  return `Modo cadastro ativado por 10 minutos.\n\nAgente destino: ${runtime.agent.name}\nEnvie uma foto ou áudio do produto/medicamento. Eu vou criar um rascunho para você aprovar.`;
}

function isTelegramKnowledgeCaptureActive(preferences, chatId) {
  const state = captureState(preferences, "telegram");
  return Boolean(state && String(state.chatId) === String(chatId));
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeKnowledgeKind(kind) {
  const value = normalizeForSearchDetection(kind || "");
  if (["product", "produto", "medicamento"].includes(value)) return "product";
  if (["price", "preço", "preço"].includes(value)) return "price";
  if (["policy", "política", "regra"].includes(value)) return "policy";
  if (["faq", "pergunta"].includes(value)) return "faq";
  if (["service", "servico", "serviço"].includes(value)) return "service";
  if (["instruction", "instrução", "instrução"].includes(value)) return "instruction";
  if (["document", "documento"].includes(value)) return "document";
  return "other";
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20);
  return String(tags || "")
    .split(/[\n,;]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function safeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.55;
  return Math.max(0, Math.min(1, number));
}

function buildKnowledgeContent(extracted) {
  const lines = [
    extracted.name ? `Nome: ${extracted.name}` : null,
    extracted.price ? `Preco: ${extracted.price}` : null,
    extracted.category ? `Categoria: ${extracted.category}` : null,
    extracted.availability ? `Disponibilidade/estoque: ${extracted.availability}` : null,
    extracted.instructions ? `Observações: ${extracted.instructions}` : null,
    extracted.safety_notes ? `Seguranca: ${extracted.safety_notes}` : null,
    "Regra de segurança: se for medicamento, não orientar dosagem, não prescrever, não substituir medicamento e encaminhar dúvidas clínicas ao farmacêutico.",
  ].filter(Boolean);
  return lines.join("\n");
}

function renderKnowledgeDraftPreview({ agent, draft }) {
  const metadata = draft.metadata || {};
  const extracted = metadata.extracted || {};
  return [
    "Rascunho criado para revisao.",
    "",
    `Agente: ${agent?.name || metadata.agent_name || "Agente ativo"}`,
    `Nome: ${draft.title}`,
    `Tipo: ${draft.kind}`,
    extracted.price ? `Preco: ${extracted.price}` : null,
    `Confianca: ${Math.round(Number(metadata.confidence || 0) * 100)}%`,
    "",
    "Conteúdo que sera salvo:",
    draft.content,
    "",
    "Aprove somente se estiver correto.",
  ].filter(Boolean).join("\n");
}

function knowledgeKeyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Aprovar", callback_data: `kg:approve:${id}` },
        { text: "✏️ Corrigir", callback_data: `kg:correct:${id}` },
        { text: "❌ Descartar", callback_data: `kg:discard:${id}` },
      ],
    ],
  };
}

async function extractKnowledgeFromText({ req, text, context, agent }) {
  const prompt = [
    "Extraia um cadastro de produto, medicamento, preço, servico, política ou FAQ para uma base de conhecimento de agente.",
    "Responda somente JSON valido, sem markdown.",
    "Campos obrigatorios: name, kind, price, category, availability, instructions, safety_notes, tags, confidence.",
    "kind deve ser um destes: product, price, policy, faq, document, service, instruction, other.",
    "Se for medicamento, inclua safety_notes conservadoras: não orientar dosagem, não prescrever e encaminhar dúvidas clínicas ao farmacêutico.",
    `Agente destino: ${agent?.name || "agente ativo"} (${agent?.domain || "custom"}).`,
    context ? `Contexto/legenda: ${context}` : null,
    "",
    "Conteúdo recebido:",
    text,
  ].filter(Boolean).join("\n");

  const answer = await callOpenRouterChat({
    req,
    model: process.env.KNOWLEDGE_EXTRACTION_MODEL || process.env.AI_VISION_MODEL || "openai/gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
    maxTokens: 1000,
  });
  const parsed = extractJsonObject(answer) || {};
  return {
    name: String(parsed.name || "Item sem nome").slice(0, 160),
    kind: normalizeKnowledgeKind(parsed.kind),
    price: parsed.price ? String(parsed.price).slice(0, 80) : "",
    category: parsed.category ? String(parsed.category).slice(0, 120) : "",
    availability: parsed.availability ? String(parsed.availability).slice(0, 160) : "",
    instructions: parsed.instructions ? String(parsed.instructions).slice(0, 1200) : "",
    safety_notes: parsed.safety_notes ? String(parsed.safety_notes).slice(0, 800) : "",
    tags: normalizeTags(parsed.tags),
    confidence: safeConfidence(parsed.confidence),
  };
}

async function extractKnowledgeFromImage({ req, imageDataUrl, caption, agent }) {
  const model = process.env.KNOWLEDGE_VISION_MODEL || process.env.AI_VISION_MODEL || "openai/gpt-4o";
  const prompt = [
    "Faça a análise desta imagem para cadastrar produto/medicamento em uma base de conhecimento.",
    "Leia rotulos e preços visiveis. Use a legenda como contexto.",
    "Responda somente JSON valido com: name, kind, price, category, availability, instructions, safety_notes, tags, confidence.",
    "kind deve ser um destes: product, price, policy, faq, document, service, instruction, other.",
    "Se for medicamento, inclua safety_notes conservadoras: não orientar dosagem, não prescrever e encaminhar dúvidas clínicas ao farmacêutico.",
    `Agente destino: ${agent?.name || "agente ativo"} (${agent?.domain || "custom"}).`,
    caption ? `Legenda/contexto: ${caption}` : null,
  ].filter(Boolean).join("\n");

  const answer = await callOpenRouterChat({
    req,
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 1000,
  });
  const parsed = extractJsonObject(answer) || {};
  return {
    name: String(parsed.name || "Item sem nome").slice(0, 160),
    kind: normalizeKnowledgeKind(parsed.kind),
    price: parsed.price ? String(parsed.price).slice(0, 80) : "",
    category: parsed.category ? String(parsed.category).slice(0, 120) : "",
    availability: parsed.availability ? String(parsed.availability).slice(0, 160) : "",
    instructions: parsed.instructions ? String(parsed.instructions).slice(0, 1200) : "",
    safety_notes: parsed.safety_notes ? String(parsed.safety_notes).slice(0, 800) : "",
    tags: normalizeTags(parsed.tags),
    confidence: safeConfidence(parsed.confidence),
  };
}

async function createKnowledgeDraft({ agent, extracted, channel, chatId, messageId, mediaType, rawText }) {
  const config = getSupabaseOwnerConfig();
  const body = {
    user_id: config.ownerUserId,
    agent_id: agent.id,
    title: extracted.name || "Item sem nome",
    kind: extracted.kind || "other",
    content: buildKnowledgeContent(extracted),
    tags: extracted.tags || [],
    priority: 3,
    is_active: false,
    metadata: {
      status: "pending_review",
      channel,
      chat_id: String(chatId || ""),
      message_id: String(messageId || ""),
      media_type: mediaType,
      agent_name: agent.name,
      confidence: extracted.confidence,
      extracted,
      raw_text: rawText,
      created_by: channel,
    },
  };
  const rows = await supabaseOwnerPost("agent_knowledge", body);
  return Array.isArray(rows) ? rows[0] : null;
}

async function findPendingKnowledgeDraft(channel) {
  const config = getSupabaseOwnerConfig();
  const rows = await supabaseOwnerGet(
    [
      `agent_knowledge?user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
      "is_active=eq.false",
      "select=*",
      "order=created_at.desc",
      "limit=20",
    ].join("&"),
  );
  return (Array.isArray(rows) ? rows : []).find((row) => row?.metadata?.status === "pending_review" && row?.metadata?.channel === channel) || null;
}

async function getKnowledgeDraftById(id) {
  const config = getSupabaseOwnerConfig();
  const rows = await supabaseOwnerGet(
    [
      `agent_knowledge?id=eq.${encodeURIComponent(id)}`,
      `user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
      "select=*",
      "limit=1",
    ].join("&"),
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function applyKnowledgeCorrection(draft, correction) {
  const metadata = { ...(draft.metadata || {}) };
  const extracted = { ...(metadata.extracted || {}) };
  const field = correction.field;
  const value = correction.value;
  const patch = { metadata: { ...metadata, extracted, corrected_at: new Date().toISOString() } };

  if (field === "nome" || field === "titulo") {
    extracted.name = value;
    patch.title = value.slice(0, 160);
  } else if (field === "preço") {
    extracted.price = value;
    patch.content = buildKnowledgeContent(extracted);
  } else if (field === "conteúdo") {
    patch.content = value.slice(0, 12000);
  } else if (field === "tipo") {
    patch.kind = normalizeKnowledgeKind(value);
  } else if (field === "tags") {
    patch.tags = normalizeTags(value);
  }

  return patch;
}

async function patchKnowledgeDraft(id, patch) {
  const rows = await supabaseOwnerPatch(`agent_knowledge?id=eq.${encodeURIComponent(id)}`, patch);
  return Array.isArray(rows) ? rows[0] : null;
}

async function handlePersonalWhatsappCommand(parsed) {
  const wantsSummary = isPersonalSummaryCommand(parsed.text);
  const wantsUrgents = isPersonalUrgentsCommand(parsed.text);
  if (!wantsSummary && !wantsUrgents) return null;

  if (!process.env.TELEGRAM_OWNER_CHAT_ID) {
    return "Para usar esse comando, configure TELEGRAM_OWNER_CHAT_ID no Vercel.";
  }
  if (!isTelegramOwnerChat(parsed.chatId)) {
    return "Esse comando só está disponível para o dono configurado.";
  }
  if (!hasPersonalWhatsappReportConfig()) {
    return "Para consultar o histórico do WhatsApp, configure SUPABASE_SERVICE_ROLE_KEY e WHATSAPP_OWNER_USER_ID no Vercel.";
  }

  const config = getSupabaseOwnerConfig();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const filters = [
    `user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
    `created_at=gte.${encodeURIComponent(since)}`,
    wantsUrgents ? "classification=in.(urgent,vip,restricted)" : "",
    "select=contact_name,contact_number,content,classification,response_text,owner_notified,notification_reason,created_at",
    "order=created_at.desc",
    "limit=30",
  ].filter(Boolean).join("&");
  const rows = await supabaseOwnerGet(`personal_whatsapp_messages?${filters}`);
  const title = wantsUrgents ? "Mensagens importantes das ultimas 24h" : "Resumo do WhatsApp pessoal nas ultimas 24h";
  return formatPersonalWhatsappRows(rows, title);
}

function isTelegramReminderCommand(text) {
  return /^\/(?:lembrar|lembrete)(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function stripTelegramReminderCommand(text) {
  return String(text || "").replace(/^\/(?:lembrar|lembrete)(?:@\w+)?\s*[:\-]?\s*/i, "").trim();
}

function isTelegramReminderListCommand(text) {
  return /^\/lembretes(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isTelegramReminderCancelCommand(text) {
  return /^\/cancelar(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isTelegramReminderAckText(text) {
  const normalized = normalizeForSearchDetection(text).replace(/[.!?]+$/g, "").trim();
  return ["ok", "feito", "pronto", "concluido", "confirmado", "ja fiz", "já fiz"].includes(normalized);
}

function looksLikeTelegramReminderRequest(text) {
  const normalized = normalizeForSearchDetection(text);
  return /(^|\b)(me lembre|lembrete|agende|agenda|lembrar)\b/.test(normalized);
}

function nowInFortaleza() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function fortalezaDateToIso(year, month, day, hour, minute) {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00-03:00`).toISOString();
}

function addDaysFortaleza(days, hour = 9, minute = 0) {
  const current = nowInFortaleza();
  const base = new Date(`${String(current.year).padStart(4, "0")}-${String(current.month).padStart(2, "0")}-${String(current.day).padStart(2, "0")}T12:00:00-03:00`);
  base.setUTCDate(base.getUTCDate() + days);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return fortalezaDateToIso(get("year"), get("month"), get("day"), hour, minute);
}

function parseTelegramReminderRecurrence(message) {
  const normalized = normalizeForSearchDetection(message);
  const match = normalized.match(/\ba cada\s+(\d{1,3})\s+(minuto|minutos|min|hora|horas|h|dia|dias)\b/);
  if (!match?.[1] || !match?.[2]) return null;

  const amount = Math.max(1, Number(match[1]));
  const unit = match[2];
  let multiplier = 60;
  if (unit === "min" || unit.startsWith("minuto")) multiplier = 1;
  if (unit === "h" || unit.startsWith("hora")) multiplier = 60;
  if (unit.startsWith("dia")) multiplier = 60 * 24;

  const intervalMinutes = amount * multiplier;
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) return null;

  return {
    recurring: true,
    intervalMinutes,
    intervalText: `a cada ${amount} ${unit}`,
  };
}

function inferTelegramReminderDateFromText(message) {
  const normalized = normalizeForSearchDetection(message);
  const now = new Date();
  const recurrence = parseTelegramReminderRecurrence(message);
  if (recurrence) {
    const date = new Date(now);
    date.setMinutes(date.getMinutes() + recurrence.intervalMinutes);
    return date.toISOString();
  }

  const inMinutes = normalized.match(/(?:em|daqui a)\s+(\d{1,3})\s+(?:minuto|minutos|min)\b/);
  if (inMinutes?.[1]) {
    const date = new Date(now);
    date.setMinutes(date.getMinutes() + Number(inMinutes[1]));
    return date.toISOString();
  }

  const inHours = normalized.match(/(?:em|daqui a)\s+(\d{1,2})\s+(?:hora|horas|h)\b/);
  if (inHours?.[1]) {
    const date = new Date(now);
    date.setHours(date.getHours() + Number(inHours[1]));
    return date.toISOString();
  }

  const explicitDate = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  const timeMatch = normalized.match(/(?:as|a|às)\s+(\d{1,2})(?::|h)?(\d{2})?/);
  const hour = timeMatch?.[1] ? Math.max(0, Math.min(23, Number(timeMatch[1]))) : 9;
  const minute = timeMatch?.[2] ? Math.max(0, Math.min(59, Number(timeMatch[2]))) : 0;

  if (explicitDate?.[1] && explicitDate?.[2]) {
    const current = nowInFortaleza();
    const yearRaw = explicitDate[3] ? Number(explicitDate[3]) : current.year;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return fortalezaDateToIso(year, Number(explicitDate[2]), Number(explicitDate[1]), hour, minute);
  }

  let dayOffset = null;
  if (normalized.includes("depois de amanha")) dayOffset = 2;
  else if (normalized.includes("amanha")) dayOffset = 1;
  else if (normalized.includes("hoje")) dayOffset = 0;

  if (dayOffset != null) {
    const iso = addDaysFortaleza(dayOffset, hour, minute);
    if (new Date(iso).getTime() <= now.getTime()) return addDaysFortaleza(dayOffset + 1, hour, minute);
    return iso;
  }

  if (timeMatch?.[1]) {
    const iso = addDaysFortaleza(0, hour, minute);
    if (new Date(iso).getTime() <= now.getTime()) return addDaysFortaleza(1, hour, minute);
    return iso;
  }

  return null;
}

function extractTelegramReminderText(message) {
  const stripped = stripTelegramReminderCommand(message);
  const source = stripped || String(message || "").trim();
  return source
    .replace(/^(por favor,?\s*)?/i, "")
    .replace(/(?:me lembre de|me lembre|lembrar de|lembrar|lembrete para|lembrete|agende|agenda)\s*[:\-]?\s*/i, "")
    .trim()
    .slice(0, 8000);
}

function formatTelegramReminderConfirmation(task) {
  const when = task.next_run_at
    ? new Date(task.next_run_at).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "data não definida";
  const recurring = task.metadata?.reminder?.recurring;
  const intervalText = task.metadata?.reminder?.intervalText;
  return [
    recurring ? "Lembrete recorrente criado." : "Lembrete criado.",
    "",
    `Quando: ${when}`,
    recurring && intervalText ? `Repetição: ${intervalText}` : null,
    `Título: ${task.title}`,
    "",
    "Vou te avisar pelo Telegram. Responda ok quando concluir; enquanto não confirmar, vou lembrar de novo a cada 5 minutos.",
  ].filter(Boolean).join("\n");
}

async function getTelegramReminderContext(parsed) {
  const context = await resolveTelegramUserContext(parsed.chatId);
  return context;
}

async function armTelegramReminderCapture(parsed, context) {
  if (!hasSupabaseServiceConfig()) {
    return "Para criar lembretes pelo Telegram, configure SUPABASE_SERVICE_ROLE_KEY no Vercel.";
  }
  const profile = await getUserProfileById(context.userId);
  const preferences = profile?.preferences || {};
  await updateUserPreferencesById(context.userId, {
    reminderCapture: {
      ...(preferences.reminderCapture || {}),
      telegram: {
        chatId: String(parsed.chatId),
        expiresAt: new Date(Date.now() + KNOWLEDGE_CAPTURE_TTL_MS).toISOString(),
      },
    },
  });
  return "Modo lembrete ativado por 10 minutos. Envie um áudio ou texto com o que devo lembrar e o horário. Ex: tomar remédio amanhã às 8h.";
}

async function clearTelegramReminderCapture(parsed, context) {
  const profile = await getUserProfileById(context.userId);
  const preferences = profile?.preferences || {};
  await updateUserPreferencesById(context.userId, {
    reminderCapture: {
      ...(preferences.reminderCapture || {}),
      telegram: {
        ...(preferences.reminderCapture?.telegram || {}),
        chatId: String(parsed.chatId),
        expiresAt: new Date(0).toISOString(),
      },
    },
  });
}

async function isTelegramReminderCaptureActive(chatId) {
  if (!hasSupabaseServiceConfig()) return false;
  const context = await resolveTelegramUserContext(chatId);
  if (!context.ok) return false;
  const profile = await getUserProfileById(context.userId);
  const preferences = profile?.preferences || {};
  const state = preferences?.reminderCapture?.telegram;
  return Boolean(state?.expiresAt && String(state.chatId) === String(chatId) && new Date(state.expiresAt).getTime() > Date.now());
}

async function createTelegramReminder({ text, parsed, context }) {
  if (!hasSupabaseServiceConfig()) {
    return { ok: false, error: "Para criar lembretes pelo Telegram, configure SUPABASE_SERVICE_ROLE_KEY no Vercel." };
  }

  const cleanText = extractTelegramReminderText(text);
  if (!cleanText || cleanText.length < 3) {
    return { ok: false, error: "Me diga o que devo lembrar. Ex: /lembrar pagar boleto amanhã às 9h." };
  }

  const nextRunAt = inferTelegramReminderDateFromText(text);
  if (!nextRunAt) {
    return { ok: false, error: "Não consegui identificar data e horário. Ex: /lembrar pagar boleto amanhã às 9h ou /lembrar tomar remédio em 30 minutos." };
  }

  const recurrence = parseTelegramReminderRecurrence(text);
  const title = cleanText.length > 100 ? `${cleanText.slice(0, 97)}...` : cleanText;
  const rows = await supabaseOwnerPost("scheduled_tasks", {
    user_id: context.userId,
    title,
    prompt: cleanText,
    recurrence: recurrence ? "hourly" : "custom",
    cron_expression: "reminder",
    next_run_at: nextRunAt,
    is_active: true,
    notification_channels: ["telegram"],
    notification_status: "pending",
    metadata: {
      reminder: {
        source: "telegram",
        telegramChatId: String(parsed.chatId),
        telegramUserName: parsed.userName || "",
        linkedUserId: context.userId,
        ackRequired: true,
        awaitingAck: false,
        snoozeMinutes: 5,
        recurring: Boolean(recurrence),
        intervalMinutes: recurrence?.intervalMinutes || null,
        intervalText: recurrence?.intervalText || null,
      },
    },
  });
  const task = Array.isArray(rows) ? rows[0] : null;
  if (!task) return { ok: false, error: "Não consegui salvar o lembrete agora. Tente novamente." };
  return { ok: true, task };
}

async function handleTelegramReminderText(parsed) {
  const context = await getTelegramReminderContext(parsed);
  if (!context.ok) return context.error;
  const directText = isTelegramReminderCommand(parsed.text) ? stripTelegramReminderCommand(parsed.text) : parsed.text;
  if (!directText.trim()) return armTelegramReminderCapture(parsed, context);
  const result = await createTelegramReminder({ text: parsed.text, parsed, context });
  if (!result.ok) return result.error;
  await clearTelegramReminderCapture(parsed, context);
  return formatTelegramReminderConfirmation(result.task);
}

async function listTelegramReminders(parsed) {
  const context = await getTelegramReminderContext(parsed);
  if (!context.ok) return context.error;
  if (!hasSupabaseServiceConfig()) return "Não consegui listar lembretes agora porque a configuração do Supabase não está completa.";
  const rows = await supabaseOwnerGet(
    `scheduled_tasks?user_id=eq.${encodeURIComponent(context.userId)}&cron_expression=eq.reminder&is_active=eq.true&select=id,title,prompt,next_run_at,notification_status,metadata&order=next_run_at.asc&limit=20`,
  );
  const tasks = Array.isArray(rows) ? rows : [];
  if (!tasks.length) return "Você não tem lembretes ativos agora.";

  const lines = tasks.map((task, index) => {
    const when = task.next_run_at
      ? new Date(task.next_run_at).toLocaleString("pt-BR", {
          timeZone: "America/Fortaleza",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "sem horário";
    const reminder = task.metadata?.reminder || {};
    const recurrence = reminder.recurring && reminder.intervalText ? `, ${reminder.intervalText}` : "";
    const waiting = reminder.awaitingAck ? ", aguardando ok" : "";
    return `${index + 1}. ${task.title} — ${when}${recurrence}${waiting}`;
  });

  return [
    "Lembretes ativos:",
    "",
    ...lines,
    "",
    "Para cancelar: /cancelar nome do lembrete",
    "Para cancelar todos: /cancelar todos",
  ].join("\n");
}

function parseTelegramCancelReminderCommand(text) {
  const raw = String(text || "").trim();
  const normalized = normalizeForSearchDetection(raw);
  if (/^\/cancelar(?:@\w+)?\s+todos$/i.test(raw) || normalized === "/cancelar todos") return { all: true, query: "" };
  const query = raw.replace(/^\/cancelar(?:@\w+)?\s*/i, "").replace(/^lembrete\s*/i, "").trim();
  return { all: false, query };
}

function telegramReminderMatchesQuery(task, query) {
  const needle = normalizeForSearchDetection(query);
  if (!needle) return false;
  const haystack = normalizeForSearchDetection(`${task.title || ""} ${task.prompt || ""}`);
  return haystack.includes(needle) || needle.includes(normalizeForSearchDetection(task.title || ""));
}

async function cancelTelegramReminders(parsed) {
  const context = await getTelegramReminderContext(parsed);
  if (!context.ok) return context.error;
  if (!hasSupabaseServiceConfig()) return "Não consegui cancelar lembretes agora porque a configuração do Supabase não está completa.";
  const command = parseTelegramCancelReminderCommand(parsed.text);
  if (!command.all && !command.query) {
    return ["Me diga qual lembrete devo cancelar.", "", "Exemplos:", "/cancelar beber água", "/cancelar todos"].join("\n");
  }

  const rows = await supabaseOwnerGet(
    `scheduled_tasks?user_id=eq.${encodeURIComponent(context.userId)}&cron_expression=eq.reminder&is_active=eq.true&select=id,title,prompt,next_run_at,metadata&order=next_run_at.asc&limit=50`,
  );
  const tasks = Array.isArray(rows) ? rows : [];
  if (!tasks.length) return "Você não tem lembretes ativos para cancelar.";

  const selected = command.all ? tasks : tasks.filter((task) => telegramReminderMatchesQuery(task, command.query));
  if (!selected.length) return `Não encontrei lembrete ativo com: ${command.query}\n\nUse /lembretes para ver os lembretes ativos.`;

  const nowIso = new Date().toISOString();
  const cancelled = [];
  for (const task of selected) {
    const reminder = task.metadata?.reminder || {};
    const updated = await supabaseOwnerPatch(
      `scheduled_tasks?id=eq.${encodeURIComponent(task.id)}&user_id=eq.${encodeURIComponent(context.userId)}`,
      {
        is_active: false,
        last_status: "success",
        notification_status: "sent",
        notification_error: null,
        notified_at: nowIso,
        metadata: {
          ...(task.metadata || {}),
          reminder: {
            ...reminder,
            awaitingAck: false,
            canceledAt: nowIso,
            canceledBy: "telegram",
          },
        },
      },
    );
    if (Array.isArray(updated) && updated.length) {
      cancelled.push(task);
      await supabaseOwnerPost("task_executions", {
        user_id: context.userId,
        scheduled_task_id: task.id,
        status: "success",
        output: "Lembrete cancelado via Telegram.",
        finished_at: nowIso,
      });
    }
  }

  if (!cancelled.length) return "Encontrei o lembrete, mas não consegui cancelar agora. Tente novamente.";
  const names = cancelled.slice(0, 8).map((task) => `- ${task.title}`).join("\n");
  const suffix = cancelled.length > 8 ? `\n- e mais ${cancelled.length - 8}` : "";
  return [cancelled.length === 1 ? "Lembrete cancelado:" : `${cancelled.length} lembretes cancelados:`, names + suffix].join("\n");
}

async function acknowledgeTelegramReminders(parsed) {
  const context = await getTelegramReminderContext(parsed);
  if (!context.ok) return null;
  if (!hasSupabaseServiceConfig()) return "Não consegui confirmar agora porque a configuração do Supabase não está completa.";
  const rows = await supabaseOwnerGet(
    `scheduled_tasks?user_id=eq.${encodeURIComponent(context.userId)}&cron_expression=eq.reminder&is_active=eq.true&select=id,title,prompt,next_run_at,metadata&order=next_run_at.asc&limit=20`,
  );
  const tasks = (Array.isArray(rows) ? rows : []).filter((task) => task?.metadata?.reminder?.awaitingAck === true);
  if (!tasks.length) return "Não encontrei lembrete aguardando confirmação agora.";

  const nowIso = new Date().toISOString();
  const summaries = [];
  for (const task of tasks) {
    const reminder = task.metadata?.reminder || {};
    const intervalMinutes = Number(reminder.intervalMinutes || 0);
    const isRecurring = Boolean(reminder.recurring && Number.isFinite(intervalMinutes) && intervalMinutes > 0);
    const nextRunAt = isRecurring ? new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString() : task.next_run_at;
    const metadata = {
      ...(task.metadata || {}),
      reminder: {
        ...reminder,
        awaitingAck: false,
        acknowledgedAt: nowIso,
        lastAcknowledgedAt: nowIso,
      },
    };
    const patch = isRecurring
      ? { next_run_at: nextRunAt, notification_status: "pending", notification_error: null, notified_at: null, metadata }
      : { is_active: false, last_status: "success", notification_status: "sent", notification_error: null, notified_at: nowIso, metadata };

    await supabaseOwnerPatch(`scheduled_tasks?id=eq.${encodeURIComponent(task.id)}&user_id=eq.${encodeURIComponent(context.userId)}`, patch);
    await supabaseOwnerPost("task_executions", {
      user_id: context.userId,
      scheduled_task_id: task.id,
      status: "success",
      output: "Lembrete confirmado via Telegram.",
      finished_at: nowIso,
    });

    if (isRecurring) {
      const when = new Date(nextRunAt).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      summaries.push(`${task.title}: confirmado. Próximo aviso em ${when}.`);
    } else {
      summaries.push(`${task.title}: confirmado e encerrado.`);
    }
  }

  return ["Ok, confirmação registrada.", "", ...summaries.slice(0, 5)].join("\n");
}

async function handleTelegramKnowledgeCallback(callbackQuery) {
  const parsed = parseKnowledgeCallback(callbackQuery.data);
  if (!parsed) return false;
  if (!isTelegramOwnerChat(callbackQuery.chatId)) {
    await answerCallbackQuery(callbackQuery.id, "Apenas o dono pode revisar cadastros.");
    return true;
  }

  if (parsed.action === "correct") {
    await answerCallbackQuery(callbackQuery.id, "Envie /corrigir campo valor");
    await sendTelegramMessage(
      callbackQuery.chatId,
      "Para corrigir, envie por exemplo:\n/corrigir preço 12,99\n/corrigir nome Dipirona 500mg\n/corrigir conteúdo texto completo",
    );
    return true;
  }

  const current = await getKnowledgeDraftById(parsed.id);
  const status = parsed.action === "approve" ? "approved" : "discarded";
  const draft = await patchKnowledgeDraft(parsed.id, {
    is_active: parsed.action === "approve",
    metadata: {
      ...(current?.metadata || {}),
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: "telegram",
    },
  });

  await answerCallbackQuery(callbackQuery.id, parsed.action === "approve" ? "Cadastro aprovado." : "Cadastro descartado.");
  await sendTelegramMessage(
    callbackQuery.chatId,
    parsed.action === "approve"
      ? `Cadastro aprovado e liberado para a IA usar: ${draft?.title || parsed.id}`
      : `Cadastro descartado: ${draft?.title || parsed.id}`,
  );
  return true;
}

async function handleTelegramKnowledgeText({ req, parsed }) {
  if (!isTelegramOwnerChat(parsed.chatId)) return null;

  if (isKnowledgeRegisterCommand(parsed.text)) {
    const details = stripKnowledgeRegisterCommand(parsed.text);
    const runtime = await loadTelegramKnowledgeRuntime();
    if (runtime.error) return runtime.error;
    if (!details) return armTelegramKnowledgeCapture(parsed.chatId);

    const extracted = await extractKnowledgeFromText({ req, text: details, context: "Mensagem de texto enviada pelo Telegram", agent: runtime.agent });
    const draft = await createKnowledgeDraft({
      agent: runtime.agent,
      extracted,
      channel: "telegram",
      chatId: parsed.chatId,
      messageId: `telegram-text-${Date.now()}`,
      mediaType: "text",
      rawText: details,
    });
    if (!draft) return "Não consegui salvar o rascunho. Verifique a configuração do Supabase.";
    await sendTelegramPayload("sendMessage", {
      chat_id: parsed.chatId,
      text: markdownToTelegramHtml(renderKnowledgeDraftPreview({ agent: runtime.agent, draft })),
      parse_mode: "HTML",
      reply_markup: knowledgeKeyboard(draft.id),
      disable_web_page_preview: true,
    });
    return "draft_sent";
  }

  const correction = parseKnowledgeCorrectionCommand(parsed.text);
  if (correction) {
    const draft = await findPendingKnowledgeDraft("telegram");
    if (!draft) return "Não encontrei rascunho pendente para corrigir.";
    const updated = await patchKnowledgeDraft(draft.id, applyKnowledgeCorrection(draft, correction));
    await sendTelegramPayload("sendMessage", {
      chat_id: parsed.chatId,
      text: markdownToTelegramHtml(renderKnowledgeDraftPreview({ agent: { name: updated?.metadata?.agent_name || "Agente ativo" }, draft: updated || draft })),
      parse_mode: "HTML",
      reply_markup: knowledgeKeyboard(draft.id),
      disable_web_page_preview: true,
    });
    return "draft_sent";
  }

  if (isKnowledgeApproveCommand(parsed.text) || isKnowledgeDiscardCommand(parsed.text)) {
    const draft = await findPendingKnowledgeDraft("telegram");
    if (!draft) return "Não encontrei rascunho pendente para revisar.";
    const approved = isKnowledgeApproveCommand(parsed.text);
    await patchKnowledgeDraft(draft.id, {
      is_active: approved,
      metadata: { ...(draft.metadata || {}), status: approved ? "approved" : "discarded", reviewed_at: new Date().toISOString(), reviewed_by: "telegram" },
    });
    return approved ? `Cadastro aprovado: ${draft.title}` : `Cadastro descartado: ${draft.title}`;
  }

  return null;
}

async function shouldHandleTelegramKnowledgeMedia(media) {
  if (!media?.chatId || !isTelegramOwnerChat(media.chatId)) return false;
  if (isKnowledgeRegisterCommand(media.caption)) return true;
  const runtime = await loadTelegramKnowledgeRuntime();
  return Boolean(runtime.preferences && isTelegramKnowledgeCaptureActive(runtime.preferences, media.chatId));
}

function getAudioTranscriptionConfig() {
  const apiKey =
    process.env.AUDIO_TRANSCRIPTION_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.AI_API_KEY;

  return {
    apiKey,
    baseUrl: process.env.AUDIO_TRANSCRIPTION_BASE_URL || OPENROUTER_API_BASE,
    model: process.env.AUDIO_TRANSCRIPTION_MODEL || "openai/whisper-large-v3",
  };
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function getWebSearchModels() {
  return uniqueValues([
    process.env.TELEGRAM_WEB_SEARCH_MODEL,
    process.env.WEB_SEARCH_MODEL,
    ...WEB_SEARCH_FALLBACK_MODELS,
  ]);
}

function audioFormatFromMime(mimeType, fileName) {
  const normalizedMime = String(mimeType || "").toLowerCase();
  const normalizedName = String(fileName || "").toLowerCase();

  if (normalizedMime.includes("webm") || normalizedName.endsWith(".webm")) return "webm";
  if (normalizedMime.includes("wav") || normalizedName.endsWith(".wav")) return "wav";
  if (normalizedMime.includes("ogg") || normalizedMime.includes("opus") || /\.(ogg|oga|opus)$/i.test(normalizedName)) return "ogg";
  if (normalizedMime.includes("m4a") || normalizedName.endsWith(".m4a")) return "m4a";
  if (normalizedMime.includes("mp4") || normalizedName.endsWith(".mp4")) return "mp4";
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3") || /\.(mp3|mpeg|mpga)$/i.test(normalizedName)) return "mp3";
  return "webm";
}

function usesOpenRouterTranscriptionEndpoint(baseUrl) {
  return String(baseUrl || "").includes("openrouter.ai");
}

function findModel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;

  return TELEGRAM_MODELS.find((model) => {
    return (
      model.id.toLowerCase() === normalized ||
      model.alias.toLowerCase() === normalized ||
      model.label.toLowerCase() === normalized
    );
  }) || null;
}

function formatModel(modelId) {
  const preset = findModel(modelId);
  return preset ? `${preset.label} (${preset.id})` : modelId;
}

function normalizeForSearchDetection(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function shouldUseRealtimeWebSearch(text) {
  const normalized = normalizeForSearchDetection(text);
  if (!normalized.trim()) return false;

  const realtimePatterns = [
    /\b(noticia|noticias|manchete|manchetes)\b/,
    /\b(hoje|agora|atual|atuais|atualmente|neste momento|em tempo real)\b/,
    /\b(preço|preços|cotação|cotações|valor atual|quanto esta|quanto custa)\b/,
    /\b(clima|previsao do tempo|tempo hoje|temperatura)\b/,
    /\b(último|últimos|ultima|ultimas|recente|recentes|novidade|novidades)\b/,
    /\b(o que aconteceu|o que esta acontecendo|me mostre|mostre|pesquise|procure|busque)\b/,
    /\b(resultado de hoje|placar|agenda de hoje|calendario de hoje)\b/,
    /\b(dolar|euro|bitcoin|btc|ethereum|eth|bolsa|ibovespa|nasdaq|selic)\b/,
  ];

  return realtimePatterns.some((pattern) => pattern.test(normalized));
}

function extractSourceLinks(payload) {
  const links = new Set();
  const add = (value) => {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) links.add(value);
  };

  if (Array.isArray(payload?.citations)) {
    for (const citation of payload.citations) {
      if (typeof citation === "string") add(citation);
      else add(citation?.url || citation?.link);
    }
  }

  const annotations = payload?.choices?.[0]?.message?.annotations;
  if (Array.isArray(annotations)) {
    for (const annotation of annotations) {
      add(annotation?.url_citation?.url || annotation?.url || annotation?.link);
    }
  }

  return [...links].slice(0, 8);
}

function getAppUrl(req) {
  return process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.host || "minha-ia-orquestrador.vercel.app"}`;
}

function normalizeTelegramText(update) {
  const message = update.message || update.edited_message;
  if (!message) return null;

  const text = message.text || message.caption;
  if (!text || !String(text).trim()) return null;

  return {
    chatId: message.chat?.id,
    userName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "Usuário",
    text: String(text).trim(),
  };
}

function normalizeTelegramAudio(update) {
  const message = update.message || update.edited_message;
  if (!message) return null;

  const audio = message.voice || message.audio || message.document;
  if (!audio?.file_id) return null;

  const mimeType = audio.mime_type || (message.voice ? "audio/ogg" : "application/octet-stream");
  const fileName =
    audio.file_name ||
    (message.voice ? `voice-${message.message_id || Date.now()}.ogg` : `audio-${message.message_id || Date.now()}`);
  const text = message.caption ? String(message.caption).trim() : "";

  if (!mimeType.startsWith("audio/") && !/\.(ogg|oga|opus|mp3|m4a|mp4|mpeg|mpga|wav|webm)$/i.test(fileName)) {
    return null;
  }

  return {
    chatId: message.chat?.id,
    userName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "Usuário",
    fileId: audio.file_id,
    fileName,
    mimeType,
    fileSize: audio.file_size || 0,
    caption: text,
  };
}

function normalizeTelegramPhoto(update) {
  const message = update.message || update.edited_message;
  if (!message?.photo?.length) return null;

  const photo = [...message.photo].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
  if (!photo?.file_id) return null;

  return {
    chatId: message.chat?.id,
    userName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "Usuário",
    fileId: photo.file_id,
    fileName: `telegram-image-${message.message_id || Date.now()}.jpg`,
    mimeType: "image/jpeg",
    fileSize: photo.file_size || 0,
    caption: message.caption ? String(message.caption).trim() : "",
  };
}

function normalizeTelegramPdf(update) {
  const message = update.message || update.edited_message;
  const document = message?.document;
  if (!document?.file_id) return null;

  const mimeType = document.mime_type || "application/octet-stream";
  const fileName = document.file_name || `telegram-document-${message.message_id || Date.now()}.pdf`;
  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(fileName);
  if (!isPdf) return null;

  return {
    chatId: message.chat?.id,
    userName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "Usuário",
    fileId: document.file_id,
    fileName,
    mimeType,
    fileSize: document.file_size || 0,
    caption: message.caption ? String(message.caption).trim() : "",
  };
}

function normalizeUnsupportedAttachment(update) {
  const message = update.message || update.edited_message;
  const document = message?.document;
  if (!document?.file_id) return null;

  const mimeType = document.mime_type || "application/octet-stream";
  const fileName = document.file_name || "arquivo";
  const isAudio = mimeType.startsWith("audio/") || /\.(ogg|oga|opus|mp3|m4a|mp4|mpeg|mpga|wav|webm)$/i.test(fileName);
  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(fileName);
  if (isAudio || isPdf) return null;

  return {
    chatId: message.chat?.id,
    fileName,
  };
}

function normalizeCallbackQuery(update) {
  const callbackQuery = update.callback_query;
  if (!callbackQuery?.message?.chat?.id || !callbackQuery.data) return null;

  return {
    id: callbackQuery.id,
    chatId: callbackQuery.message.chat.id,
    messageId: callbackQuery.message.message_id,
    data: String(callbackQuery.data),
  };
}

function isStartCommand(text) {
  return /^\/start(?:\s|$)/i.test(String(text || "").trim());
}

function isResetCommand(text) {
  return /^\/reset(?:\s|$)/i.test(String(text || "").trim());
}

function isModelsCommand(text) {
  return /^\/modelos(?:\s|$)/i.test(String(text || "").trim());
}

function parseModelCommand(text) {
  const match = String(text || "").trim().match(/^\/modelo(?:@\w+)?(?:\s+(.+))?$/i);
  if (!match) return null;
  return { requested: match[1]?.trim() || "" };
}

function parseModelCallback(data) {
  const match = String(data || "").match(/^model:set:(.+)$/);
  return match ? match[1] : null;
}

function parseKnowledgeCallback(data) {
  const match = String(data || "").match(/^kg:(approve|correct|discard):([0-9a-f-]{36})$/i);
  return match ? { action: match[1], id: match[2] } : null;
}

function isWebSearchCallback(data) {
  return String(data || "") === "web:next";
}

function parseUpdate(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function alreadyProcessed(updateId) {
  if (!updateId && updateId !== 0) return false;
  const key = String(updateId);

  const now = Date.now();
  for (const [id, timestamp] of processedUpdates.entries()) {
    if (now - timestamp > UPDATE_DEDUPE_TTL_MS) processedUpdates.delete(id);
  }

  if (processedUpdates.has(key)) return true;
  processedUpdates.set(key, now);
  return false;
}

function getSession(chatId) {
  const key = String(chatId);
  const now = Date.now();
  const current = sessions.get(key);

  if (current && now - current.updatedAt < SESSION_TTL_MS) {
    return current;
  }

  const fresh = {
    updatedAt: now,
    model: getModel(),
    forceWebNext: false,
    messages: [
      {
        role: "system",
        content: [
          "Você e Minha IA no Telegram.",
          "Responda sempre em português do Brasil.",
          "Seja direto, útil e profissional.",
          `Modelo ativo atual: ${getModel()}.`,
          "Se perguntarem qual modelo você usa, informe exatamente o modelo ativo acima.",
          "Nunca se apresente como JK Store, loja, catálogo, atendimento de compras ou suporte de produtos, a menos que o usuário configure isso explicitamente nesta conversa.",
          "Mantenha continuidade usando o histórico recente desta conversa.",
          "Não diga que acessou sistemas externos quando isso não aconteceu.",
        ].join(" "),
      },
    ],
  };

  sessions.set(key, fresh);
  return fresh;
}

function resetSession(chatId) {
  sessions.delete(String(chatId));
  return getSession(chatId);
}

function updateSystemPrompt(session) {
  const model = session.model || getModel();
  session.messages[0] = {
    role: "system",
    content: [
      "Você e Minha IA no Telegram.",
      "Responda sempre em português do Brasil.",
      "Seja direto, útil e profissional.",
      `Modelo ativo atual: ${model}.`,
      "Se perguntarem qual modelo você usa, informe exatamente o modelo ativo acima.",
      "Nunca se apresente como JK Store, loja, catálogo, atendimento de compras ou suporte de produtos, a menos que o usuário configure isso explicitamente nesta conversa.",
      "Mantenha continuidade usando o histórico recente desta conversa.",
      "Não diga que acessou sistemas externos quando isso não aconteceu.",
    ].join(" "),
  };
}

function remember(chatId, role, content) {
  const session = getSession(chatId);
  session.updatedAt = Date.now();
  updateSystemPrompt(session);
  session.messages.push({ role, content });

  const system = session.messages[0];
  const recent = session.messages.slice(1).slice(-MAX_HISTORY_MESSAGES);
  session.messages = [system, ...recent];
}

async function askOpenRouter({ req, chatId, userName, text, modelOverride, webSearch = false }) {
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY não configurada.");
  }

  remember(chatId, "user", `${userName}: ${text}`);
  const session = getSession(chatId);
  const modelCandidates = Array.isArray(modelOverride)
    ? uniqueValues(modelOverride)
    : uniqueValues([modelOverride || session.model || getModel(), getTelegramFallbackModel()]);
  updateSystemPrompt(session);
  const messages = webSearch
    ? [
        {
          role: "system",
          content: [
            "Você e Minha IA no Telegram com pesquisa web em tempo real.",
            "Responda sempre em português do Brasil.",
            "Use informações atuais e verifique fatos recentes.",
            "Inclua uma seção final chamada Fontes com links clicáveis das fontes usadas.",
            "Se a informação estiver incerta, diga isso claramente.",
          ].join(" "),
        },
        ...session.messages.slice(1),
      ]
    : session.messages;

  let lastError;
  for (const model of modelCandidates) {
    const response = await fetchWithTimeout(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": getAppUrl(req),
        "X-Title": process.env.APP_NAME || "Minha IA",
      },
      body: JSON.stringify({
        model,
        temperature: Number(process.env.AI_TEMPERATURE || 0.4),
        max_tokens: Number(process.env.TELEGRAM_MAX_TOKENS || Math.min(Number(process.env.AI_MAX_TOKENS || 4096), 1600)),
        messages,
      }),
    }, Number(process.env.TELEGRAM_OPENROUTER_TIMEOUT_MS || 7000)).catch((error) => {
      lastError = error;
      telegramLogger.error("telegram openrouter timeout/network error", { model, error: error instanceof Error ? error.message : String(error) });
      return null;
    });

    if (!response) continue;

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      lastError = new Error(payload?.error?.message || `OpenRouter não conseguiu responder com ${model}.`);
      telegramLogger.error("telegram openrouter model error", { model, error: lastError instanceof Error ? lastError.message : String(lastError) });
      continue;
    }

    let answer = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!answer) {
      lastError = new Error(`O modelo ${model} retornou uma resposta vazia.`);
      telegramLogger.error("telegram openrouter empty answer", { model });
      continue;
    }

    if (webSearch && !/fontes\s*:/i.test(normalizeForSearchDetection(answer))) {
      const sources = extractSourceLinks(payload);
      if (sources.length) {
        answer = `${answer}\n\nFontes:\n${sources.map((source) => `- ${source}`).join("\n")}`;
      }
    }

    remember(chatId, "assistant", answer);
    return answer;
  }

  throw lastError || new Error("OpenRouter não conseguiu responder agora.");
}

async function askOpenRouterWithRealtimeSearch({ req, chatId, userName, text }) {
  return askOpenRouter({
    req,
    chatId,
    userName,
    text,
    modelOverride: getWebSearchModels(),
    webSearch: true,
  });
}

async function callOpenRouterChat({ req, model, messages, temperature = 0.3, maxTokens = 1800 }) {
  const apiKey = getOpenRouterKey();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY não configurada.");
  }

  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getAppUrl(req),
      "X-Title": process.env.APP_NAME || "Minha IA",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenRouter não conseguiu responder com ${model}.`);
  }

  const answer = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!answer) {
    throw new Error(`O modelo ${model} retornou uma resposta vazia.`);
  }

  return answer;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function askOpenRouterWithVision({ req, chatId, userName, caption, imageDataUrl }) {
  const session = getSession(chatId);
  session.updatedAt = Date.now();
  updateSystemPrompt(session);

  const prompt = [
    caption ? `Pedido/legenda do usuário: ${caption}` : "Faça a análise desta imagem enviada pelo usuário.",
    "Descreva os elementos visíveis, leia textos se houver, destaque detalhes importantes e responda de forma útil em português do Brasil.",
  ].join("\n");

  const messages = [
    ...session.messages,
    {
      role: "user",
      content: [
        { type: "text", text: `${userName}: ${prompt}` },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];

  const preferredModels = [
    process.env.TELEGRAM_IMAGE_MODEL,
    process.env.AI_VISION_MODEL,
    ...TELEGRAM_IMAGE_MODELS,
  ].filter(Boolean);

  let lastError;
  for (const model of [...new Set(preferredModels)]) {
    try {
      const answer = await callOpenRouterChat({ req, model, messages, temperature: 0.25, maxTokens: 1800 });
      remember(chatId, "user", `${userName}: enviou uma imagem. ${caption ? `Legenda: ${caption}` : ""}`.trim());
      remember(chatId, "assistant", answer);
      return { answer, model };
    } catch (error) {
      lastError = error;
      telegramLogger.error("telegram image model error", { model, error: error instanceof Error ? error.message : String(error) });
    }
  }

  throw lastError || new Error("Nenhum modelo com visao conseguiu analisar a imagem.");
}

async function askFromTranscribedAudio({ req, chatId, userName, transcription, caption }) {
  const prompt = [
    caption ? `Instrucao/legenda do usuário: ${caption}` : null,
    "Transcrição do áudio enviado pelo Telegram:",
    transcription,
    "",
    "Responda ao conteúdo do áudio de forma útil.",
  ]
    .filter(Boolean)
    .join("\n");

  return askOpenRouter({ req, chatId, userName, text: prompt });
}

async function askFromPdfText({ req, chatId, userName, pdfText, fileName, caption }) {
  const prompt = [
    caption ? `Instrucao/legenda do usuário: ${caption}` : null,
    `Documento PDF recebido: ${fileName}`,
    "",
    "Texto extraído do PDF:",
    pdfText.slice(0, MAX_PDF_TEXT_CHARS),
    "",
    "Análise o documento, resuma os pontos principais e responda ao usuário de forma útil em português do Brasil.",
  ]
    .filter(Boolean)
    .join("\n");

  return askOpenRouter({ req, chatId, userName, text: prompt });
}

async function downloadTelegramFile(fileId, maxBytes) {
  const token = getTelegramToken();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN não configurado.");
  }

  const filePayload = await sendTelegramPayload("getFile", { file_id: fileId });
  const filePath = filePayload?.result?.file_path;
  const fileSize = filePayload?.result?.file_size || 0;

  if (!filePath) {
    throw new Error("Telegram não retornou o caminho do arquivo.");
  }

  if (fileSize > maxBytes) {
    throw new Error("Arquivo muito grande para baixar pelo bot.");
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`);
  if (!response.ok) {
    throw new Error("Não foi possível baixar o arquivo do Telegram.");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error("Arquivo muito grande para processar.");
  }

  return {
    buffer: Buffer.from(arrayBuffer),
    filePath,
    fileSize,
  };
}

async function transcribeTelegramAudio({ audioBuffer, fileName, mimeType }) {
  const config = getAudioTranscriptionConfig();
  if (!config.apiKey) {
    return { text: "", error: "Transcrição de áudio não configurada. Defina OPENROUTER_API_KEY." };
  }

  if (usesOpenRouterTranscriptionEndpoint(config.baseUrl)) {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://minha-ia-orquestrador.vercel.app",
        "X-Title": process.env.APP_NAME || "Minha IA",
      },
      body: JSON.stringify({
        input_audio: {
          data: audioBuffer.toString("base64"),
          format: audioFormatFromMime(mimeType, fileName),
        },
        model: config.model,
        language: "pt",
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { text: "", model: config.model, error: payload?.error?.message || "Falha ao transcrever áudio." };
    }

    return { text: String(payload?.text || "").trim(), model: config.model, error: "" };
  }

  const formData = new FormData();
  const bytes = new Uint8Array(audioBuffer.length);
  bytes.set(audioBuffer);
  const blob = new Blob([bytes], { type: mimeType || "audio/ogg" });
  formData.append("file", blob, fileName);
  formData.append("model", config.model);
  formData.append("language", "pt");
  formData.append("response_format", "json");
  formData.append("prompt", "Transcreva em português do Brasil quando o áudio estiver em português. Preserve nomes, números, datas e pedidos de lembrete.");

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://minha-ia-orquestrador.vercel.app",
    "X-Title": process.env.APP_NAME || "Minha IA",
  };

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { text: "", error: payload?.error?.message || "Falha ao transcrever áudio." };
  }

  return { text: String(payload?.text || "").trim(), model: config.model, error: "" };
}

async function handleTelegramAudio({ req, audio }) {
  if (!audio.chatId) {
    return;
  }

  if (audio.fileSize > MAX_TELEGRAM_AUDIO_BYTES) {
    await sendTelegramMessage(audio.chatId, "Esse áudio ficou grande demais para eu processar agora. Tente enviar um áudio menor.");
    return;
  }

  await sendTelegramPayload("sendChatAction", {
    chat_id: audio.chatId,
    action: "typing",
  });

  const { buffer: audioBuffer } = await downloadTelegramFile(audio.fileId, MAX_TELEGRAM_AUDIO_BYTES);
  const transcription = await transcribeTelegramAudio({
    audioBuffer,
    fileName: audio.fileName,
    mimeType: audio.mimeType,
  });

  if (!transcription.text) {
    throw new Error(transcription.error || "Whisper não retornou transcrição.");
  }

  const needsWebSearch = shouldUseRealtimeWebSearch(`${audio.caption || ""}\n${transcription.text}`);
  if (needsWebSearch) {
    await sendTelegramMessage(audio.chatId, "🌐 Pesquisando na internet...");
  }

  let answer;
  if (needsWebSearch) {
    try {
      answer = await askOpenRouterWithRealtimeSearch({
          req,
          chatId: audio.chatId,
          userName: audio.userName,
          text: [
            audio.caption ? `Instrucao/legenda do usuário: ${audio.caption}` : null,
            "Transcrição do áudio enviado pelo Telegram:",
            transcription.text,
            "",
            "Responda ao conteúdo do áudio usando pesquisa web atual e inclua fontes.",
          ]
            .filter(Boolean)
            .join("\n"),
        });
    } catch (searchError) {
      telegramLogger.error("telegram audio web search error", { error: searchError instanceof Error ? searchError.message : String(searchError) });
      answer = await askFromTranscribedAudio({
        req,
        chatId: audio.chatId,
        userName: audio.userName,
        transcription: transcription.text,
        caption: audio.caption,
      });
      answer = `Não consegui pesquisar na internet agora, mas consegui transcrever e responder com o modelo ativo.\n\n${answer}`;
    }
  } else {
    answer = await askFromTranscribedAudio({
      req,
      chatId: audio.chatId,
      userName: audio.userName,
      transcription: transcription.text,
      caption: audio.caption,
    });
  }

  await sendTelegramMessage(audio.chatId, `🎤 Você disse: ${transcription.text}\n\n${answer}`);
}

async function shouldHandleTelegramReminderAudio(audioData) {
  if (!audioData?.chatId || !isTelegramOwnerChat(audioData.chatId)) return false;
  if (isTelegramReminderCommand(audioData.caption)) return true;
  return isTelegramReminderCaptureActive(audioData.chatId);
}

async function handleTelegramReminderAudio({ audio }) {
  const parsed = {
    chatId: audio.chatId,
    userName: audio.userName,
    text: audio.caption || "",
  };
  const context = await getTelegramReminderContext(parsed);
  if (!context.ok) {
    await sendTelegramMessage(audio.chatId, context.error);
    return;
  }
  if (audio.fileSize > MAX_TELEGRAM_AUDIO_BYTES) {
    await sendTelegramMessage(audio.chatId, "Esse áudio ficou grande demais para criar lembrete. Tente enviar um áudio menor.");
    return;
  }

  await sendTelegramPayload("sendChatAction", { chat_id: audio.chatId, action: "typing" });
  const { buffer: audioBuffer } = await downloadTelegramFile(audio.fileId, MAX_TELEGRAM_AUDIO_BYTES);
  const transcription = await transcribeTelegramAudio({
    audioBuffer,
    fileName: audio.fileName,
    mimeType: audio.mimeType,
  });

  if (!transcription.text) {
    await sendTelegramMessage(audio.chatId, "Recebi seu áudio, mas não consegui transcrever agora. Tente enviar por texto ou reenviar o áudio.");
    return;
  }

  const caption = stripTelegramReminderCommand(audio.caption || "");
  const reminderText = [caption, transcription.text].filter(Boolean).join(" ").trim();
  const result = await createTelegramReminder({ text: reminderText, parsed: { ...parsed, text: reminderText }, context });
  if (!result.ok) {
    await sendTelegramMessage(audio.chatId, `🎤 Você disse: ${transcription.text}\n\n${result.error}`);
    return;
  }

  await clearTelegramReminderCapture(parsed, context);
  await sendTelegramMessage(audio.chatId, `🎤 Você disse: ${transcription.text}\n\n${formatTelegramReminderConfirmation(result.task)}`);
}

async function handleTelegramKnowledgeAudio({ req, audio }) {
  const runtime = await loadTelegramKnowledgeRuntime();
  if (runtime.error) {
    await sendTelegramMessage(audio.chatId, runtime.error);
    return;
  }
  if (audio.fileSize > MAX_TELEGRAM_AUDIO_BYTES) {
    await sendTelegramMessage(audio.chatId, "Esse áudio ficou grande demais para cadastrar. Tente enviar um áudio menor.");
    return;
  }

  await sendTelegramPayload("sendChatAction", { chat_id: audio.chatId, action: "typing" });
  const { buffer: audioBuffer } = await downloadTelegramFile(audio.fileId, MAX_TELEGRAM_AUDIO_BYTES);
  const transcription = await transcribeTelegramAudio({
    audioBuffer,
    fileName: audio.fileName,
    mimeType: audio.mimeType,
  });
  if (!transcription.text) throw new Error(transcription.error || "Whisper não retornou transcrição.");

  const extracted = await extractKnowledgeFromText({
    req,
    text: transcription.text,
    context: stripKnowledgeRegisterCommand(audio.caption || "Áudio de cadastro enviado pelo Telegram"),
    agent: runtime.agent,
  });
  const draft = await createKnowledgeDraft({
    agent: runtime.agent,
    extracted,
    channel: "telegram",
    chatId: audio.chatId,
    messageId: audio.fileId,
    mediaType: "audio",
    rawText: transcription.text,
  });
  if (!draft) {
    await sendTelegramMessage(audio.chatId, "Não consegui salvar o rascunho. Verifique a configuração do Supabase.");
    return;
  }

  await sendTelegramPayload("sendMessage", {
    chat_id: audio.chatId,
    text: markdownToTelegramHtml(`🎤 Transcrição usada:\n${transcription.text}\n\n${renderKnowledgeDraftPreview({ agent: runtime.agent, draft })}`),
    parse_mode: "HTML",
    reply_markup: knowledgeKeyboard(draft.id),
    disable_web_page_preview: true,
  });
}

async function handleTelegramPhoto({ req, photo }) {
  if (!photo.chatId) return;

  if (photo.fileSize > MAX_TELEGRAM_IMAGE_BYTES) {
    await sendTelegramMessage(photo.chatId, "Essa imagem ficou grande demais para eu analisar agora. Tente enviar uma imagem menor.");
    return;
  }

  await sendTelegramPayload("sendChatAction", {
    chat_id: photo.chatId,
    action: "typing",
  });

  const { buffer } = await downloadTelegramFile(photo.fileId, MAX_TELEGRAM_IMAGE_BYTES);
  const imageDataUrl = `data:${photo.mimeType};base64,${buffer.toString("base64")}`;
  const { answer } = await askOpenRouterWithVision({
    req,
    chatId: photo.chatId,
    userName: photo.userName,
    caption: photo.caption,
    imageDataUrl,
  });

  await sendTelegramMessage(photo.chatId, `🖼️ Sobre a imagem:\n\n${answer}`);
}

async function handleTelegramKnowledgePhoto({ req, photo }) {
  const runtime = await loadTelegramKnowledgeRuntime();
  if (runtime.error) {
    await sendTelegramMessage(photo.chatId, runtime.error);
    return;
  }
  if (photo.fileSize > MAX_TELEGRAM_IMAGE_BYTES) {
    await sendTelegramMessage(photo.chatId, "Essa imagem ficou grande demais para cadastrar. Tente enviar uma imagem menor.");
    return;
  }

  await sendTelegramPayload("sendChatAction", { chat_id: photo.chatId, action: "typing" });
  const { buffer } = await downloadTelegramFile(photo.fileId, MAX_TELEGRAM_IMAGE_BYTES);
  const imageDataUrl = `data:${photo.mimeType};base64,${buffer.toString("base64")}`;
  const extracted = await extractKnowledgeFromImage({
    req,
    imageDataUrl,
    caption: stripKnowledgeRegisterCommand(photo.caption || ""),
    agent: runtime.agent,
  });
  const draft = await createKnowledgeDraft({
    agent: runtime.agent,
    extracted,
    channel: "telegram",
    chatId: photo.chatId,
    messageId: photo.fileId,
    mediaType: "image",
    rawText: photo.caption || "",
  });
  if (!draft) {
    await sendTelegramMessage(photo.chatId, "Não consegui salvar o rascunho. Verifique a configuração do Supabase.");
    return;
  }

  await sendTelegramPayload("sendMessage", {
    chat_id: photo.chatId,
    text: markdownToTelegramHtml(`🖼️ Imagem analisada para cadastro.\n\n${renderKnowledgeDraftPreview({ agent: runtime.agent, draft })}`),
    parse_mode: "HTML",
    reply_markup: knowledgeKeyboard(draft.id),
    disable_web_page_preview: true,
  });
}

async function extractPdfText(buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    return String(result?.text || "").replace(/\s+\n/g, "\n").trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function handleTelegramPdf({ req, pdf }) {
  if (!pdf.chatId) return;

  if (pdf.fileSize > MAX_TELEGRAM_PDF_BYTES) {
    await sendTelegramMessage(pdf.chatId, "Esse PDF ficou grande demais para eu processar agora. Tente enviar um arquivo menor.");
    return;
  }

  await sendTelegramPayload("sendChatAction", {
    chat_id: pdf.chatId,
    action: "typing",
  });

  const { buffer } = await downloadTelegramFile(pdf.fileId, MAX_TELEGRAM_PDF_BYTES);
  const pdfText = await extractPdfText(buffer);
  if (!pdfText) {
    await sendTelegramMessage(pdf.chatId, "Recebi o PDF, mas não consegui extrair texto dele. Se for um PDF escaneado como imagem, envie as páginas como foto.");
    return;
  }

  const answer = await askFromPdfText({
    req,
    chatId: pdf.chatId,
    userName: pdf.userName,
    pdfText,
    fileName: pdf.fileName,
    caption: pdf.caption,
  });

  await sendTelegramMessage(pdf.chatId, `📄 Sobre o documento:\n\n${answer}`);
}

function modelKeyboard(chatId) {
  const active = getSession(chatId).model || getModel();
  const webButton = {
    text: "🌐 Pesquisa Web (Perplexity)",
    callback_data: "web:next",
  };
  const buttons = TELEGRAM_MODELS.map((model) => ({
    text: `${model.id === active ? "✓ " : ""}${model.label}`,
    callback_data: `model:set:${model.alias}`,
  }));

  const rows = [[webButton]];
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2));
  }

  return { inline_keyboard: rows };
}

function compactModelsMessage(chatId) {
  const active = getSession(chatId).model || getModel();
  return [
    "Escolha o modelo que quer usar nesta conversa.",
    "",
    `Ativo: ${formatModel(active)}`,
    "",
    "Pesquisa web: toque em \"🌐 Pesquisa Web (Perplexity)\" para pesquisar na internet na proxima mensagem.",
    "",
    `Áudio automático: ${getAudioTranscriptionConfig().model}`,
  ].join("\n");
}

function enableWebSearchNext(chatId) {
  const session = getSession(chatId);
  session.forceWebNext = true;
  session.updatedAt = Date.now();
  return [
    "🌐 Pesquisa Web ativada para a proxima mensagem.",
    "",
    `Vou usar ${getWebSearchModels()[0]} uma vez e depois volto para o modelo ativo: ${formatModel(session.model || getModel())}.`,
  ].join("\n");
}

function setModelForSession(chatId, requested) {
  const session = getSession(chatId);
  if (/^(web|internet|pesquisa|perplexity)$/i.test(String(requested || "").trim())) {
    return enableWebSearchNext(chatId);
  }

  const selected = findModel(requested);

  if (!selected) {
    return [
      `Não encontrei o modelo "${requested}".`,
      "",
      "Use /modelos para ver os aliases disponíveis.",
    ].join("\n");
  }

  session.model = selected.id;
  updateSystemPrompt(session);

  return [
    `Modelo alterado para: ${selected.label}`,
    selected.id,
    "",
    "Essa troca vale para esta conversa no Telegram enquanto a sessão estiver ativa.",
  ].join("\n");
}

function setModelForSessionResult(chatId, requested) {
  const session = getSession(chatId);
  if (/^(web|internet|pesquisa|perplexity)$/i.test(String(requested || "").trim())) {
    return {
      ok: true,
      webSearch: true,
      text: enableWebSearchNext(chatId),
    };
  }

  const selected = findModel(requested);

  if (!selected) {
    return {
      ok: false,
      text: [
        `Não encontrei o modelo "${requested}".`,
        "",
        "Use /modelos para ver os modelos disponíveis.",
      ].join("\n"),
    };
  }

  session.model = selected.id;
  updateSystemPrompt(session);

  return {
    ok: true,
    model: selected,
    text: [
      `Modelo alterado para: ${selected.label}`,
      selected.id,
      "",
      "Pode mandar a proxima mensagem.",
    ].join("\n"),
  };
}

async function sendTelegramPayload(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN não configurado.");
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responsePayload = await response.json().catch(() => ({}));
    throw new Error(responsePayload?.description || `Falha ao chamar Telegram ${method}.`);
  }

  return response.json().catch(() => ({}));
}

async function sendTelegramModelSelector(chatId) {
  await sendTelegramPayload("sendMessage", {
    chat_id: chatId,
    text: compactModelsMessage(chatId),
    reply_markup: modelKeyboard(chatId),
    disable_web_page_preview: true,
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  if (!callbackQueryId) return;
  await sendTelegramPayload("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

async function editModelSelector(chatId, messageId) {
  if (!messageId) return;
  await sendTelegramPayload("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: compactModelsMessage(chatId),
    reply_markup: modelKeyboard(chatId),
    disable_web_page_preview: true,
  });
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN não configurado.");
  }

  const chunks = splitTelegramMessage(text);

  for (const chunk of chunks) {
    try {
      await sendTelegramPayload("sendMessage", {
        chat_id: chatId,
        text: markdownToTelegramHtml(chunk),
        parse_mode: "HTML",
        disable_web_page_preview: false,
      });
    } catch (error) {
      telegramLogger.error("telegram html send error, retrying plain text", { error: error instanceof Error ? error.message : String(error) });
      await sendTelegramPayload("sendMessage", {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: false,
      });
    }
  }
}

function escapeTelegramHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramAttribute(value) {
  return escapeTelegramHtml(value).replace(/"/g, "&quot;");
}

function markdownToTelegramHtml(value) {
  let text = String(value || "").trim();
  const placeholders = [];

  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    const token = `__TG_LINK_${placeholders.length}__`;
    placeholders.push(
      `<a href="${escapeTelegramAttribute(url)}">${escapeTelegramHtml(label)}</a>`,
    );
    return token;
  });

  text = escapeTelegramHtml(text);
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  text = text.replace(/__([^_\n]+)__/g, "<b>$1</b>");
  text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  placeholders.forEach((html, index) => {
    text = text.replace(`__TG_LINK_${index}__`, html);
  });

  return text;
}

function splitTelegramMessage(text) {
  const limit = 3900;
  const chunks = [];
  let remaining = String(text || "").trim();

  while (remaining.length > limit) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }

  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : ["Não consegui gerar uma resposta agora."];
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      name: "Minha IA Telegram webhook",
      mode: "webhook",
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      aiConfigured: Boolean(getOpenRouterKey()),
      model: getModel(),
      personalWhatsappCommands: true,
      personalWhatsappReportsConfigured: hasPersonalWhatsappReportConfig(),
      telegramOwnerConfigured: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID),
      telegramMultiUser: {
        enabled: hasSupabaseServiceConfig(),
        linkCommand: "/vincular CODIGO",
        storage: "user_profiles.preferences.telegramIntegration",
      },
      knowledgeRegistration: true,
      reminderRegistration: {
        text: true,
        naturalText: true,
        audioAfterCommand: true,
        recurring: true,
        ackRequired: true,
        listCommand: "/lembretes",
        cancelCommand: "/cancelar nome",
        command: "/lembrar",
      },
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }

  // Fail-closed: se a secret nao esta configurada, recusar todas as requests.
  // Isso forc a o deployer a setar TELEGRAM_WEBHOOK_SECRET e impede o webhook
  // ficar silenciosamente aberto em ambientes sem env var.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return res.status(503).json({ ok: false, error: "Webhook secret nao configurado." });
  }
  if (req.headers["x-telegram-bot-api-secret-token"] !== expectedSecret) {
    return res.status(401).json({ ok: false, error: "Webhook nao autorizado." });
  }

  const update = parseUpdate(req.body);

  if (alreadyProcessed(update.update_id)) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  const parsed = normalizeTelegramText(update);
  const callbackQuery = normalizeCallbackQuery(update);
  const audio = normalizeTelegramAudio(update);
  const photo = normalizeTelegramPhoto(update);
  const pdf = normalizeTelegramPdf(update);
  const unsupportedAttachment = normalizeUnsupportedAttachment(update);

  if (callbackQuery) {
    try {
      if (await handleTelegramKnowledgeCallback(callbackQuery)) {
        return res.status(200).json({ ok: true, knowledgeCallback: true });
      }

      if (isWebSearchCallback(callbackQuery.data)) {
        const message = enableWebSearchNext(callbackQuery.chatId);
        await answerCallbackQuery(callbackQuery.id, "Pesquisa web ativada.");
        await editModelSelector(callbackQuery.chatId, callbackQuery.messageId);
        await sendTelegramMessage(callbackQuery.chatId, message);
        return res.status(200).json({ ok: true, webSearchCallback: true });
      }

      const requestedModel = parseModelCallback(callbackQuery.data);
      if (!requestedModel) {
        await answerCallbackQuery(callbackQuery.id, "Opção não reconhecida.");
        return res.status(200).json({ ok: true, callbackIgnored: true });
      }

      const result = setModelForSessionResult(callbackQuery.chatId, requestedModel);
      await answerCallbackQuery(callbackQuery.id, result.ok ? `Modelo: ${result.model?.label || "Pesquisa Web"}` : "Modelo não encontrado.");
      await editModelSelector(callbackQuery.chatId, callbackQuery.messageId);
      await sendTelegramMessage(callbackQuery.chatId, result.text);
      return res.status(200).json({ ok: true, callback: true });
    } catch (error) {
      telegramLogger.error("telegram callback error", { error: error instanceof Error ? error.message : String(error) });
      await answerCallbackQuery(callbackQuery.id, "Não consegui trocar agora.");
      return res.status(200).json({ ok: true, callbackHandledWithFallback: true });
    }
  }

  if (audio?.chatId) {
    try {
      if (await shouldHandleTelegramReminderAudio(audio)) {
        await handleTelegramReminderAudio({ audio });
        return res.status(200).json({ ok: true, reminderAudio: true });
      }
      if (await shouldHandleTelegramKnowledgeMedia(audio)) {
        await handleTelegramKnowledgeAudio({ req, audio });
        return res.status(200).json({ ok: true, knowledgeAudio: true });
      }
      await handleTelegramAudio({ req, audio });
      return res.status(200).json({ ok: true, audio: true });
    } catch (error) {
      telegramLogger.error("telegram audio error", { error: error instanceof Error ? error.message : String(error) });
      await sendTelegramMessage(
        audio.chatId,
        "Recebi seu áudio, mas não consegui processar agora. Verifique a conexão do provedor de IA ou tente reenviar.",
      );
      return res.status(200).json({ ok: true, audioHandledWithFallback: true });
    }
  }

  if (photo?.chatId) {
    try {
      if (await shouldHandleTelegramKnowledgeMedia(photo)) {
        await handleTelegramKnowledgePhoto({ req, photo });
        return res.status(200).json({ ok: true, knowledgePhoto: true });
      }
      await handleTelegramPhoto({ req, photo });
      return res.status(200).json({ ok: true, photo: true });
    } catch (error) {
      telegramLogger.error("telegram photo error", { error: error instanceof Error ? error.message : String(error) });
      await sendTelegramMessage(
        photo.chatId,
        "Recebi sua imagem, mas não consegui analisar agora. Tente reenviar a foto ou enviar uma versão menor.",
      );
      return res.status(200).json({ ok: true, photoHandledWithFallback: true });
    }
  }

  if (pdf?.chatId) {
    try {
      await handleTelegramPdf({ req, pdf });
      return res.status(200).json({ ok: true, pdf: true });
    } catch (error) {
      telegramLogger.error("telegram pdf error", { error: error instanceof Error ? error.message : String(error) });
      await sendTelegramMessage(
        pdf.chatId,
        "Recebi seu PDF, mas não consegui processar agora. Tente reenviar o arquivo ou enviar um PDF menor.",
      );
      return res.status(200).json({ ok: true, pdfHandledWithFallback: true });
    }
  }

  if (unsupportedAttachment?.chatId) {
    await sendTelegramMessage(
      unsupportedAttachment.chatId,
      `Recebi o arquivo "${unsupportedAttachment.fileName}", mas por enquanto eu analiso automaticamente texto, áudio, fotos e PDFs.`,
    );
    return res.status(200).json({ ok: true, unsupportedAttachment: true });
  }

  if (!parsed?.chatId) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const normalizedTelegramCommand = normalizeForSearchDetection(parsed.text).trim();
    if (["/meuid", "/id"].includes(normalizedTelegramCommand)) {
      await sendTelegramMessage(
        parsed.chatId,
        `Seu TELEGRAM_OWNER_CHAT_ID e: ${parsed.chatId}\n\nColoque esse valor no Vercel para liberar comandos administrativos e cadastro de conhecimento pelo Telegram.`,
      );
      return res.status(200).json({ ok: true, ownerIdHelp: true });
    }

    if (isTelegramLinkCommand(parsed.text)) {
      await sendTelegramMessage(parsed.chatId, await handleTelegramLinkCommand(parsed));
      return res.status(200).json({ ok: true, telegramLinked: true });
    }

    if (isTelegramReminderAckText(parsed.text)) {
      const answer = await acknowledgeTelegramReminders(parsed);
      if (answer) {
        await sendTelegramMessage(parsed.chatId, answer);
        return res.status(200).json({ ok: true, reminderAck: true });
      }
    }

    if (isTelegramReminderListCommand(parsed.text)) {
      await sendTelegramMessage(parsed.chatId, await listTelegramReminders(parsed));
      return res.status(200).json({ ok: true, reminderList: true });
    }

    if (isTelegramReminderCancelCommand(parsed.text)) {
      await sendTelegramMessage(parsed.chatId, await cancelTelegramReminders(parsed));
      return res.status(200).json({ ok: true, reminderCancel: true });
    }

    if (isTelegramReminderCommand(parsed.text) || (isTelegramOwnerChat(parsed.chatId) && looksLikeTelegramReminderRequest(parsed.text))) {
      await sendTelegramMessage(parsed.chatId, await handleTelegramReminderText(parsed));
      return res.status(200).json({ ok: true, reminderText: true });
    }

    const knowledgeTextAnswer = await handleTelegramKnowledgeText({ req, parsed });
    if (knowledgeTextAnswer) {
      if (knowledgeTextAnswer !== "draft_sent") await sendTelegramMessage(parsed.chatId, knowledgeTextAnswer);
      return res.status(200).json({ ok: true, knowledgeText: true });
    }

    const personalCommandAnswer = await handlePersonalWhatsappCommand(parsed);
    if (personalCommandAnswer) {
      await sendTelegramMessage(parsed.chatId, personalCommandAnswer);
      return res.status(200).json({ ok: true, personalWhatsappCommand: true });
    }

    if (isStartCommand(parsed.text)) {
      resetSession(parsed.chatId);
      remember(parsed.chatId, "assistant", WELCOME_MESSAGE);
      await sendTelegramMessage(parsed.chatId, WELCOME_MESSAGE);
      return res.status(200).json({ ok: true, started: true });
    }

    if (isResetCommand(parsed.text)) {
      resetSession(parsed.chatId);
      await sendTelegramMessage(parsed.chatId, "Conversa reiniciada. O modelo voltou para o padrão: " + formatModel(getModel()));
      return res.status(200).json({ ok: true, reset: true });
    }

    if (isModelsCommand(parsed.text)) {
      await sendTelegramModelSelector(parsed.chatId);
      return res.status(200).json({ ok: true, models: true });
    }

    const modelCommand = parseModelCommand(parsed.text);
    if (modelCommand) {
      if (!modelCommand.requested) {
        await sendTelegramModelSelector(parsed.chatId);
        return res.status(200).json({ ok: true, modelSelector: true });
      }

      const message = setModelForSession(parsed.chatId, modelCommand.requested);
      await sendTelegramMessage(parsed.chatId, message);
      return res.status(200).json({ ok: true, model: true });
    }

    const session = getSession(parsed.chatId);
    const forceWebSearch = Boolean(session.forceWebNext);
    const automaticWebSearch = shouldUseRealtimeWebSearch(parsed.text);

    if (forceWebSearch || automaticWebSearch) {
      session.forceWebNext = false;
      await sendTelegramMessage(parsed.chatId, "🌐 Pesquisando na internet...");
      await sendTelegramPayload("sendChatAction", {
        chat_id: parsed.chatId,
        action: "typing",
      });

      const searchPrompt = [
        `Data atual: ${new Date().toISOString()}.`,
        forceWebSearch
          ? "O usuário forcou pesquisa web pelo menu do Telegram."
          : "O sistema detectou que esta pergunta precisa de informações atuais em tempo real.",
        "",
        parsed.text,
      ].join("\n");
      let answer;
      try {
        answer = await askOpenRouterWithRealtimeSearch({ req, ...parsed, text: searchPrompt });
      } catch (searchError) {
        telegramLogger.error("telegram web search error", { error: searchError instanceof Error ? searchError.message : String(searchError) });
        answer = await askOpenRouter({ req, ...parsed });
        answer = `Não consegui concluir a pesquisa na internet agora, entao respondi com o modelo ativo.\n\n${answer}`;
      }

      await sendTelegramMessage(parsed.chatId, answer);
      return res.status(200).json({ ok: true, webSearch: true, forced: forceWebSearch });
    }

    const answer = await askOpenRouter({ req, ...parsed });
    await sendTelegramMessage(parsed.chatId, answer);
    return res.status(200).json({ ok: true });
  } catch (error) {
    telegramLogger.error("telegram webhook error", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });

    try {
      await sendTelegramMessage(
        parsed.chatId,
        "Desculpa, não consegui responder agora. Tente novamente em alguns instantes.",
      );
    } catch (sendError) {
      telegramLogger.error("telegram fallback send error", { error: sendError instanceof Error ? sendError.message : String(sendError) });
    }

    return res.status(200).json({ ok: true, handledWithFallback: true });
  }
}

