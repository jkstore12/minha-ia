const MAX_HISTORY_MESSAGES = 20;
const SESSION_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_WHATSAPP_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_WHATSAPP_IMAGE_BYTES = 12 * 1024 * 1024;
const KNOWLEDGE_CAPTURE_TTL_MS = 10 * 60 * 1000;
const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_EVOLUTION_API_URL = "https://evolution-api-production-d8ba.up.railway.app";
const WHATSAPP_IMAGE_MODELS = ["openai/gpt-4o", "~anthropic/claude-sonnet-latest"];
const DEFAULT_OUT_OF_HOURS_MESSAGE = "Oi! Estou ocupado agora, mas retorno assim que puder.";
const REMINDER_ACK_SNOOZE_MINUTES = 5;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

const sessions = globalThis.__minhaIaWhatsappSessions || new Map();
globalThis.__minhaIaWhatsappSessions = sessions;
const processedMessages = globalThis.__minhaIaWhatsappProcessedMessages || new Map();
globalThis.__minhaIaWhatsappProcessedMessages = processedMessages;
const whatsappRuntimeCache = globalThis.__minhaIaWhatsappRuntimeCache || new Map();
globalThis.__minhaIaWhatsappRuntimeCache = whatsappRuntimeCache;

function getOpenRouterKey() {
  return process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
}

function getModel() {
  return process.env.AI_MODEL || process.env.OPENAI_MODEL || "openai/gpt-chat-latest";
}

function getPersonalModel() {
  return process.env.PERSONAL_WHATSAPP_MODEL || "~anthropic/claude-sonnet-latest";
}

function getSupabaseServiceConfig() {
  return {
    url: String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    ownerUserId: process.env.WHATSAPP_OWNER_USER_ID || "",
  };
}

function hasWhatsappAgentServiceConfig() {
  const config = getSupabaseServiceConfig();
  return Boolean(config.url && config.serviceRoleKey && config.ownerUserId);
}

function getAudioTranscriptionConfig() {
  return {
    apiKey:
      process.env.AUDIO_TRANSCRIPTION_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.AI_API_KEY,
    baseUrl: process.env.AUDIO_TRANSCRIPTION_BASE_URL || OPENROUTER_API_BASE,
    model: process.env.AUDIO_TRANSCRIPTION_MODEL || "openai/whisper-large-v3",
  };
}

function getEvolutionConfig(req) {
  return {
    baseUrl: (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_API_URL).replace(/\/$/, ""),
    apiKey: process.env.EVOLUTION_API_KEY,
    instance: process.env.WHATSAPP_INSTANCE_NAME || "minha-ia",
    appUrl: process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.host || "minha-ia-orquestrador.vercel.app"}`,
  };
}

function parseBody(body) {
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

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function safeAgentString(value) {
  return String(value || "").trim();
}

async function supabaseServiceGet(path) {
  const config = getSupabaseServiceConfig();
  if (!hasWhatsappAgentServiceConfig()) return null;

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.error("whatsapp supabase service error", response.status, payload);
    return null;
  }
  return payload;
}

async function supabaseServicePatch(path, body) {
  const config = getSupabaseServiceConfig();
  if (!hasWhatsappAgentServiceConfig()) return null;

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
    console.error("whatsapp supabase patch error", response.status, payload);
    return null;
  }
  return payload;
}

async function supabaseServicePost(path, body) {
  const config = getSupabaseServiceConfig();
  if (!hasWhatsappAgentServiceConfig()) return null;

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
    console.error("whatsapp supabase post error", response.status, payload);
    return null;
  }
  return payload;
}

async function loadWhatsappRuntimeConfig() {
  const fallback = { botEnabled: true, agent: null, serviceConfigured: false };
  if (!hasWhatsappAgentServiceConfig()) return fallback;

  const config = getSupabaseServiceConfig();
  const cacheKey = `${config.ownerUserId}:whatsapp-runtime`;
  const cached = whatsappRuntimeCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < 2_000) return cached.runtime;

  const profileRows = await supabaseServiceGet(
    `user_profiles?id=eq.${encodeURIComponent(config.ownerUserId)}&select=preferences&limit=1`,
  );
  const preferences = Array.isArray(profileRows) ? profileRows[0]?.preferences || {} : {};
  const botEnabled = preferences?.whatsappBotEnabled !== false;
  const whatsappAgentId = safeAgentString(preferences?.whatsappAgentId);
  const whatsappKnowledgeAgentId = safeAgentString(
    preferences?.whatsappKnowledgeAgentId || preferences?.knowledgeAgentId || preferences?.whatsappAgentId,
  );

  if (!whatsappAgentId) {
    const knowledgeAgent = whatsappKnowledgeAgentId
      ? await loadWhatsappAgentById(whatsappKnowledgeAgentId, config.ownerUserId)
      : null;
    const runtime = { botEnabled, agent: null, knowledgeAgent, preferences, serviceConfigured: true };
    whatsappRuntimeCache.set(cacheKey, { updatedAt: Date.now(), runtime });
    return runtime;
  }

  const agent = await loadWhatsappAgentById(whatsappAgentId, config.ownerUserId);
  const knowledgeAgent = whatsappKnowledgeAgentId === whatsappAgentId
    ? agent
    : await loadWhatsappAgentById(whatsappKnowledgeAgentId, config.ownerUserId);
  let knowledge = [];
  if (agent?.id) {
    const knowledgeRows = await supabaseServiceGet(
      [
        `agent_knowledge?user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
        `agent_id=eq.${encodeURIComponent(agent.id)}`,
        "is_active=eq.true",
        "select=title,kind,content,tags,priority,source_url",
        "order=priority.asc,updated_at.desc",
        "limit=20",
      ].join("&"),
    );
    knowledge = Array.isArray(knowledgeRows) ? knowledgeRows : [];
  }
  const runtime = { botEnabled, agent, knowledgeAgent, knowledge, preferences, serviceConfigured: true };
  whatsappRuntimeCache.set(cacheKey, { updatedAt: Date.now(), runtime });
  return runtime;
}

async function loadWhatsappAgentById(agentId, ownerUserId) {
  const id = safeAgentString(agentId);
  if (!id) return null;
  const agentRows = await supabaseServiceGet(
    [
      `agents?id=eq.${encodeURIComponent(id)}`,
      `user_id=eq.${encodeURIComponent(ownerUserId)}`,
      "is_active=eq.true",
      "select=id,name,domain,description,system_prompt,tools,model,temperature,max_tokens,metadata",
      "limit=1",
    ].join("&"),
  );
  return Array.isArray(agentRows) ? agentRows[0] || null : null;
}

async function updateWhatsappPreferences(nextPartial) {
  if (!hasWhatsappAgentServiceConfig()) return null;
  const config = getSupabaseServiceConfig();
  const profileRows = await supabaseServiceGet(
    `user_profiles?id=eq.${encodeURIComponent(config.ownerUserId)}&select=preferences&limit=1`,
  );
  const current = Array.isArray(profileRows) ? profileRows[0]?.preferences || {} : {};
  const preferences = { ...current, ...nextPartial };
  const result = await supabaseServicePatch(`user_profiles?id=eq.${encodeURIComponent(config.ownerUserId)}`, {
    preferences,
    updated_at: new Date().toISOString(),
  });
  whatsappRuntimeCache.delete(`${config.ownerUserId}:whatsapp-runtime`);
  return Array.isArray(result) ? result[0]?.preferences || preferences : preferences;
}

function stripWhatsappKnowledgeCommand(text) {
  return String(text || "").replace(/^#cadastrar/i, "").trim();
}

function isWhatsappKnowledgeRegisterText(text) {
  return normalizeText(text).startsWith("#cadastrar");
}

function isWhatsappKnowledgeCommandText(text) {
  const normalized = normalizeText(text);
  return (
    normalized === "#cadastrar" ||
    normalized === "#aprovar" ||
    normalized === "#descartar" ||
    normalized.startsWith("#corrigir ")
  );
}

function parseWhatsappCorrectionCommand(text) {
  const match = String(text || "").trim().match(/^#corrigir\s+(nome|titulo|título|preço|preço|conteúdo|conteúdo|tipo|tags)\s+(.+)$/i);
  if (!match) return null;
  return { field: normalizeText(match[1]), value: match[2].trim() };
}

function captureState(preferences, channel) {
  const state = preferences?.knowledgeCapture?.[channel];
  if (!state?.expiresAt || new Date(state.expiresAt).getTime() < Date.now()) return null;
  return state;
}

async function armWhatsappKnowledgeCapture(runtime, parsed) {
  if (!hasWhatsappAgentServiceConfig()) {
    return "Para cadastrar conhecimento pelo WhatsApp, configure SUPABASE_SERVICE_ROLE_KEY e WHATSAPP_OWNER_USER_ID no Vercel.";
  }
  const targetAgent = runtime.knowledgeAgent || runtime.agent;
  if (!targetAgent?.id) {
    return "Escolha o agente destino dos cadastros do WhatsApp na Central de Agentes antes de cadastrar produtos ou medicamentos.";
  }
  const current = runtime.preferences || {};
  await updateWhatsappPreferences({
    knowledgeCapture: {
      ...(current.knowledgeCapture || {}),
      whatsapp: {
        agentId: targetAgent.id,
        chatId: parsed.chatId,
        expiresAt: new Date(Date.now() + KNOWLEDGE_CAPTURE_TTL_MS).toISOString(),
      },
    },
  });
  whatsappRuntimeCache.delete(`${getSupabaseServiceConfig().ownerUserId}:whatsapp-runtime`);
  return `Modo cadastro ativado por 10 minutos.\n\nAgente destino: ${targetAgent.name}\nEnvie uma foto ou áudio do produto/medicamento. Vou criar um rascunho para você aprovar antes de entrar na base.`;
}

function isWhatsappKnowledgeCaptureActive(runtime, parsed) {
  const state = captureState(runtime.preferences, "whatsapp");
  return Boolean(state && String(state.chatId) === String(parsed.chatId));
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
  const value = normalizeText(kind || "");
  if (["product", "produto", "medicamento"].includes(value)) return "product";
  if (["price", "preço"].includes(value)) return "price";
  if (["policy", "política", "regra"].includes(value)) return "policy";
  if (["faq", "pergunta"].includes(value)) return "faq";
  if (["service", "servico"].includes(value)) return "service";
  if (["instruction", "instrução"].includes(value)) return "instruction";
  if (["document", "documento"].includes(value)) return "document";
  return "other";
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 20);
  return String(tags || "").split(/[\n,;]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
}

function safeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.55;
  return Math.max(0, Math.min(1, number));
}

function buildKnowledgeContent(extracted) {
  return [
    extracted.name ? `Nome: ${extracted.name}` : null,
    extracted.price ? `Preco: ${extracted.price}` : null,
    extracted.category ? `Categoria: ${extracted.category}` : null,
    extracted.availability ? `Disponibilidade/estoque: ${extracted.availability}` : null,
    extracted.instructions ? `Observações: ${extracted.instructions}` : null,
    extracted.safety_notes ? `Seguranca: ${extracted.safety_notes}` : null,
    "Regra de segurança: se for medicamento, não orientar dosagem, não prescrever, não substituir medicamento e encaminhar dúvidas clínicas ao farmacêutico.",
  ].filter(Boolean).join("\n");
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
    "Comandos:",
    "#aprovar - liberar para a IA usar",
    "#corrigir preço 12,99",
    "#corrigir nome Dipirona 500mg",
    "#descartar - descartar rascunho",
  ].filter(Boolean).join("\n");
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
  const answer = await callOpenRouterChat({
    req,
    model: process.env.KNOWLEDGE_VISION_MODEL || process.env.AI_VISION_MODEL || "openai/gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Faça a análise desta imagem para cadastrar produto/medicamento em uma base de conhecimento.",
              "Leia rotulos e preços visiveis. Use a legenda como contexto.",
              "Responda somente JSON valido com: name, kind, price, category, availability, instructions, safety_notes, tags, confidence.",
              "kind deve ser um destes: product, price, policy, faq, document, service, instruction, other.",
              "Se for medicamento, inclua safety_notes conservadoras: não orientar dosagem, não prescrever e encaminhar dúvidas clínicas ao farmacêutico.",
              `Agente destino: ${agent?.name || "agente ativo"} (${agent?.domain || "custom"}).`,
              caption ? `Legenda/contexto: ${caption}` : null,
            ].filter(Boolean).join("\n"),
          },
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
  const config = getSupabaseServiceConfig();
  const rows = await supabaseServicePost("agent_knowledge", {
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
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function findPendingKnowledgeDraft(channel) {
  const config = getSupabaseServiceConfig();
  const rows = await supabaseServiceGet(
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

function applyKnowledgeCorrection(draft, correction) {
  const metadata = { ...(draft.metadata || {}) };
  const extracted = { ...(metadata.extracted || {}) };
  const patch = { metadata: { ...metadata, extracted, corrected_at: new Date().toISOString() } };
  if (correction.field === "nome" || correction.field === "titulo") {
    extracted.name = correction.value;
    patch.title = correction.value.slice(0, 160);
  } else if (correction.field === "preço") {
    extracted.price = correction.value;
    patch.content = buildKnowledgeContent(extracted);
  } else if (correction.field === "conteúdo") {
    patch.content = correction.value.slice(0, 12000);
  } else if (correction.field === "tipo") {
    patch.kind = normalizeKnowledgeKind(correction.value);
  } else if (correction.field === "tags") {
    patch.tags = normalizeTags(correction.value);
  }
  return patch;
}

async function patchKnowledgeDraft(id, patch) {
  const rows = await supabaseServicePatch(`agent_knowledge?id=eq.${encodeURIComponent(id)}`, patch);
  return Array.isArray(rows) ? rows[0] : null;
}

function renderAgentKnowledge(knowledge) {
  if (!Array.isArray(knowledge) || !knowledge.length) return "";
  return [
    "Base de conhecimento especifica do agente ativo:",
    ...knowledge.slice(0, 20).map((item) => {
      const tags = Array.isArray(item.tags) && item.tags.length ? ` Tags: ${item.tags.map(String).join(", ")}.` : "";
      const source = item.source_url ? ` Fonte: ${safeAgentString(item.source_url)}.` : "";
      return `- [${safeAgentString(item.kind || "other")}] ${safeAgentString(item.title)}.${tags}${source}\n  ${safeAgentString(item.content)}`;
    }),
    "Use esta base como fonte preferencial. Não invente preço, estoque, regra, disponibilidade ou política que não esteja nesta base.",
  ].join("\n");
}

function renderWhatsappSystemPrompt(agent, knowledge = []) {
  const base = [
    "Você e Minha IA no WhatsApp.",
    "Responda sempre em português do Brasil.",
    "Seja direto, útil e profissional.",
    `Modelo ativo atual: ${agent?.model || getModel()}.`,
    "Mantenha continuidade usando o histórico recente desta conversa.",
    "Não diga que acessou sistemas externos quando isso não aconteceu.",
  ];

  if (agent) {
    base.push(`Agente ativo no WhatsApp: ${safeAgentString(agent.name)} (${safeAgentString(agent.domain)}).`);
    if (agent.description) base.push(`Missao: ${safeAgentString(agent.description)}`);
    if (Array.isArray(agent.tools) && agent.tools.length) base.push(`Capacidades declaradas: ${agent.tools.map(String).join(", ")}.`);
    if (agent.system_prompt) base.push(`Instruções do agente ativo:\n${safeAgentString(agent.system_prompt)}`);
    const knowledgePrompt = renderAgentKnowledge(knowledge);
    if (knowledgePrompt) base.push(knowledgePrompt);
    base.push("Use o agente ativo como regra principal da conversa neste canal.");
  }

  return base.join("\n");
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function parseList(value) {
  return String(value || "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isCommandText(text) {
  const normalized = normalizeText(text);
  return (
    isReminderAckText(text) ||
    ["#pausar", "#ativar", "#cadastrar", "#aprovar", "#descartar", "#lembretes", "#cancelar", "#cancelar todos"].includes(normalized) ||
    normalized.startsWith("#corrigir ") ||
    normalized.startsWith("#cancelar ") ||
    normalized === "#lembrar" ||
    normalized === "#lembrete" ||
    normalized.startsWith("#lembrar ") ||
    normalized.startsWith("#lembrete ") ||
    looksLikeReminderRequest(text)
  );
}

function isReminderCommandText(text) {
  const normalized = normalizeText(text);
  return normalized === "#lembrar" || normalized === "#lembrete" || normalized.startsWith("#lembrar ") || normalized.startsWith("#lembrete ");
}

function stripReminderCommand(text) {
  return String(text || "").replace(/^#(?:lembrar|lembrete)\s*[:\-]?\s*/i, "").trim();
}

function isReminderAckText(text) {
  const normalized = normalizeText(text).replace(/[.!?]+$/g, "").trim();
  return ["ok", "feito", "pronto", "concluido", "confirmado", "ja fiz", "já fiz"].includes(normalized);
}

function isOwnerNumber(number) {
  const owner = normalizeDigits(process.env.PERSONAL_WHATSAPP_OWNER_NUMBER || "");
  const candidate = normalizeDigits(number || "");
  return Boolean(owner && candidate && (candidate.endsWith(owner) || owner.endsWith(candidate)));
}

function isOwnerCommandAuthorized(parsed) {
  return Boolean(parsed?.fromMe || isOwnerNumber(parsed?.number));
}

function parseTimeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Math.max(0, Math.min(23, Number(match[1] || 0)));
  const minute = Math.max(0, Math.min(59, Number(match[2] || 0)));
  return hour * 60 + minute;
}

function getCurrentTimeParts(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Fortaleza",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const weekdayRaw = String(parts.find((part) => part.type === "weekday")?.value || "").toLowerCase();
  const weekdayMap = { sun: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat" };
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return {
    weekday: weekdayMap[weekdayRaw.slice(0, 3)] || "mon",
    minutes: hour * 60 + minute,
  };
}

function isWithinPersonalHours(profileOrHours) {
  if (profileOrHours && typeof profileOrHours === "object") {
    const profile = profileOrHours;
    const days = Array.isArray(profile.availableDays) && profile.availableDays.length
      ? profile.availableDays
      : ["mon", "tue", "wed", "thu", "fri"];
    const start = parseTimeToMinutes(profile.startTime || "08:00");
    const end = parseTimeToMinutes(profile.endTime || "18:00");
    if (start == null || end == null) return true;
    const current = getCurrentTimeParts(profile.timezone || "America/Fortaleza");
    if (!days.includes(current.weekday)) return false;
    if (start <= end) return current.minutes >= start && current.minutes <= end;
    return current.minutes >= start || current.minutes <= end;
  }

  const value = normalizeText(profileOrHours || "");
  const matches = [...value.matchAll(/(\d{1,2})(?::?(\d{2}))?\s*h?/g)];
  if (matches.length < 2) return true;

  const toMinutes = (match) => {
    const hour = Math.max(0, Math.min(23, Number(match[1] || 0)));
    const minute = Math.max(0, Math.min(59, Number(match[2] || 0)));
    return hour * 60 + minute;
  };

  const start = toMinutes(matches[0]);
  const end = toMinutes(matches[1]);
  const current = getCurrentTimeParts("America/Fortaleza").minutes;

  if (start <= end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function describePersonalSchedule(profile) {
  const dayLabels = {
    mon: "segunda",
    tue: "terça",
    wed: "quarta",
    thu: "quinta",
    fri: "sexta",
    sat: "sábado",
    sun: "domingo",
  };
  const days = Array.isArray(profile?.availableDays) && profile.availableDays.length
    ? profile.availableDays
    : ["mon", "tue", "wed", "thu", "fri"];
  const dayText = days.map((day) => dayLabels[day] || day).join(", ");
  const start = profile?.startTime || "08:00";
  const end = profile?.endTime || "18:00";
  const timezone = profile?.timezone || "America/Fortaleza";
  return `${dayText}, das ${start} às ${end} (${timezone})`;
}

function getAgentSchedule(agent) {
  const schedule = agent?.metadata?.schedule;
  if (!schedule || typeof schedule !== "object") return null;
  return {
    enabled: Boolean(schedule.enabled),
    availableDays: Array.isArray(schedule.availableDays) && schedule.availableDays.length
      ? schedule.availableDays.map(String)
      : ["mon", "tue", "wed", "thu", "fri"],
    startTime: String(schedule.startTime || "08:00"),
    endTime: String(schedule.endTime || "18:00"),
    timezone: String(schedule.timezone || "America/Fortaleza"),
    outOfHoursMessage: String(schedule.outOfHoursMessage || DEFAULT_OUT_OF_HOURS_MESSAGE),
  };
}

function isWithinAgentSchedule(agent) {
  const schedule = getAgentSchedule(agent);
  if (!schedule?.enabled) return true;
  return isWithinPersonalHours(schedule);
}

function getAgentOutOfHoursMessage(agent) {
  const schedule = getAgentSchedule(agent);
  return schedule?.outOfHoursMessage || DEFAULT_OUT_OF_HOURS_MESSAGE;
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

function inferReminderDateFromText(message) {
  const normalized = normalizeText(message);
  const now = new Date();
  const recurrence = parseReminderRecurrence(message);
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

function extractReminderText(message) {
  const stripped = stripReminderCommand(message);
  const source = stripped || String(message || "").trim();
  return source
    .replace(/^(por favor,?\s*)?/i, "")
    .replace(/(?:me lembre de|me lembre|lembrar de|lembrar|lembrete para|lembrete|agende|agenda)\s*[:\-]?\s*/i, "")
    .trim()
    .slice(0, 8000);
}

function parseReminderRecurrence(message) {
  const normalized = normalizeText(message);
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

function nextIsoAfterMinutes(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function looksLikeReminderRequest(text) {
  const normalized = normalizeText(text);
  return /(^|\b)(me lembre|lembrete|agende|agenda|lembrar)\b/.test(normalized);
}

function formatReminderConfirmation(task) {
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
    "Quando eu te avisar, responda ok para confirmar. Enquanto não confirmar, vou insistir a cada 5 minutos.",
  ].filter(Boolean).join("\n");
}

function classifyPersonalMessage(parsed, preferences) {
  const text = normalizeText(parsed.text);
  const contactName = normalizeText(parsed.userName);
  const number = normalizeDigits(parsed.number);
  const profile = preferences?.personalProfile || {};
  const vipItems = parseList(preferences?.personalVipContacts);
  const urgentTopics = parseList(preferences?.personalUrgentTopics);
  const haystack = `${contactName} ${number} ${text}`;

  const isVip = vipItems.some((item) => {
    const normalized = normalizeText(item);
    const digits = normalizeDigits(item);
    return Boolean((normalized && haystack.includes(normalized)) || (digits && number.includes(digits)));
  });

  const urgentPatterns = [
    /\burgente\b/,
    /\bemergência\b/,
    /\bpreciso falar\b/,
    /\bimportante\b/,
    /\bagora\b/,
    /\bme liga\b/,
    /\bliga pra mim\b/,
  ];
  const urgentByTopic = urgentTopics.some((topic) => {
    const normalized = normalizeText(topic);
    return normalized && text.includes(normalized);
  });
  const isFinancial = /\b(pix|dinheiro|pagamento|boleto|banco|cartao|emprestimo|transferencia|financiamento|cobranca|divida)\b/.test(text);
  const isHealthOrEmergency = /\b(saúde|hospital|medico|emergência|ambulancia|dor no peito|falta de ar|desmaio|acidente|sangramento|gravidez|febre alta)\b/.test(text);
  const isCommitment = /\b(confirmar|confirma|compromisso|reuniao|contrato|assinatura|viagem|consulta|agenda)\b/.test(text);
  const isSpam = /\b(corrente|encaminhe|promocao imperdivel|ganhe dinheiro|clique aqui|sorteio|aposta|blaze|bonus|cupom|marketing)\b/.test(text);
  const urgent = isVip || urgentByTopic || urgentPatterns.some((pattern) => pattern.test(text)) || isFinancial || isHealthOrEmergency;
  const restricted = isFinancial || isHealthOrEmergency || isCommitment;
  const withinHours = isWithinPersonalHours(profile);

  let classification = "normal";
  if (isSpam && !urgent) classification = "spam";
  else if (restricted) classification = "restricted";
  else if (isVip) classification = "vip";
  else if (urgent) classification = "urgent";

  const urgencyScore = Math.min(100, (urgent ? 70 : 0) + (isVip ? 20 : 0) + (restricted ? 10 : 0));
  return {
    classification,
    isVip,
    isSpam,
    urgent,
    restricted,
    withinHours,
    urgencyScore,
    notifyOwner: isVip || urgent || restricted,
    notificationReason: [
      isVip ? "contato VIP" : null,
      urgent ? "mensagem urgente" : null,
      restricted ? "assunto sensivel" : null,
      !withinHours ? "fora do horário" : null,
    ].filter(Boolean).join(", "),
  };
}

function buildPersonalAgent(preferences, classification) {
  const profile = preferences?.personalProfile || {};
  const prompt = [
    "Você responde o WhatsApp pessoal do dono de forma natural e discreta.",
    "Não revele que é uma IA, exceto se perguntarem diretamente.",
    "Tom casual com amigos e familia; tom profissional com clientes e trabalho.",
    profile.name ? `Nome do dono: ${profile.name}.` : null,
    profile.profession ? `Profissão do dono: ${profile.profession}.` : null,
    `Horário disponível: ${describePersonalSchedule(profile)}.`,
    "Não tome decisões financeiras, não confirme compromissos importantes e não responda orientação de saúde/emergência.",
    "Se faltar contexto, responda curto e natural, sem prometer algo que depende do dono.",
    "Evite parecer atendimento robotico. So responda a mensagem atual.",
    classification?.withinHours === false ? "O dono está fora do horário disponível; use resposta breve dizendo que retorna em breve." : null,
  ].filter(Boolean).join("\n");

  return {
    name: "Agente Pessoal WhatsApp",
    domain: "support",
    model: getPersonalModel(),
    temperature: 0.45,
    max_tokens: 1800,
    system_prompt: prompt,
    tools: [],
  };
}

async function sendTelegramOwnerNotification(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return false;

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  return response.ok;
}

function renderOwnerAlert(parsed, classification) {
  return [
    "Alerta do WhatsApp pessoal",
    "",
    `Contato: ${parsed.userName || "Sem nome"} (${parsed.number})`,
    `Classificação: ${classification.classification}`,
    classification.notificationReason ? `Motivo: ${classification.notificationReason}` : null,
    "",
    parsed.text,
  ].filter(Boolean).join("\n");
}

async function logPersonalMessage({ parsed, classification, responseText, ownerNotified, metadata = {} }) {
  if (!hasWhatsappAgentServiceConfig()) return;
  const config = getSupabaseServiceConfig();
  await supabaseServicePost("personal_whatsapp_messages", {
    user_id: config.ownerUserId,
    message_id: parsed.messageId,
    chat_id: parsed.chatId,
    contact_number: parsed.number || "",
    contact_name: parsed.userName || "",
    direction: responseText ? "outbound" : classification.classification === "spam" ? "ignored" : "inbound",
    content: parsed.text || parsed.media?.caption || "",
    classification: classification.classification,
    urgency_score: classification.urgencyScore || 0,
    is_vip: Boolean(classification.isVip),
    is_group: Boolean(parsed.isGroup),
    is_spam: Boolean(classification.isSpam),
    response_text: responseText || null,
    owner_notified: Boolean(ownerNotified),
    notification_reason: classification.notificationReason || null,
    metadata,
  });
}

function restrictedReply(classification) {
  if (classification.classification === "restricted") {
    return "Recebi sua mensagem. Esse assunto e importante, entao vou ver pessoalmente e te retorno assim que puder.";
  }
  return "";
}

async function handlePersonalText({ req, parsed, runtime }) {
  const preferences = runtime.preferences || {};
  const classification = classifyPersonalMessage(parsed, preferences);

  if (classification.isSpam) {
    await logPersonalMessage({ parsed, classification, responseText: "", ownerNotified: false, metadata: { ignored_reason: "spam" } });
    return { ignored: true };
  }

  let ownerNotified = false;
  if (classification.notifyOwner) {
    ownerNotified = await sendTelegramOwnerNotification(renderOwnerAlert(parsed, classification));
  }

  let responseText = restrictedReply(classification);
  if (!responseText && !classification.withinHours) {
    responseText = preferences?.personalProfile?.outOfHoursMessage || "Oi! Estou ocupado agora, mas retorno assim que puder.";
  }

  if (!responseText) {
    const personalAgent = buildPersonalAgent(preferences, classification);
    responseText = await askOpenRouter({
      req,
      chatId: parsed.chatId,
      userName: parsed.userName,
      text: parsed.text,
      agent: personalAgent,
    });
  }

  if (responseText) {
    await sendWhatsAppText(parsed.number, responseText);
  }

  await logPersonalMessage({
    parsed,
    classification,
    responseText,
    ownerNotified,
    metadata: {
      model: getPersonalModel(),
      within_hours: classification.withinHours,
      personal_agent: true,
    },
  });

  return { ok: true, classification: classification.classification, ownerNotified };
}

function normalizeRemoteJid(remoteJid) {
  return String(remoteJid || "")
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@c\.us$/i, "")
    .replace(/@lid$/i, "")
    .replace(/\D/g, "");
}

function getReplyTargetNumber(key, data, update) {
  const candidates = [
    key?.remoteJidAlt,
    data?.remoteJidAlt,
    update?.remoteJidAlt,
    data?.senderAlt,
    key?.participantAlt,
    key?.remoteJid,
    data?.remoteJid,
    update?.remoteJid,
    data?.sender,
    data?.from,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "");
    if (!value || value.includes("status@broadcast") || value.endsWith("@g.us")) continue;
    if (value.endsWith("@lid") && candidates.some((item) => String(item || "").endsWith("@s.whatsapp.net"))) {
      continue;
    }

    const normalized = normalizeRemoteJid(value);
    if (normalized.length >= 10) return normalized;
  }

  return "";
}

function getTextFromMessage(message) {
  return firstDefined(
    message?.conversation,
    message?.extendedTextMessage?.text,
    message?.imageMessage?.caption,
    message?.videoMessage?.caption,
    message?.documentMessage?.caption,
    message?.buttonsResponseMessage?.selectedDisplayText,
    message?.buttonsResponseMessage?.selectedButtonId,
    message?.listResponseMessage?.title,
    message?.listResponseMessage?.singleSelectReply?.selectedRowId,
    message?.templateButtonReplyMessage?.selectedDisplayText,
  );
}

function getMessageParts(update) {
  const data = update?.data || update || {};
  const messageRecord = data?.messages?.[0] || data;
  const message = messageRecord?.message || data?.message || update?.message || {};
  const key = messageRecord?.key || data?.key || data?.messages?.[0]?.key || update?.key || {};
  return { data, messageRecord, message, key };
}

function detectMessageType(message, data) {
  const explicitType = String(
    firstDefined(data?.messageType, data?.typeMessage, data?.type, data?.msgType, ""),
  ).toLowerCase();

  if (message?.imageMessage || explicitType.includes("image")) return "image";
  if (
    message?.audioMessage ||
    explicitType.includes("audio") ||
    explicitType.includes("ptt") ||
    explicitType.includes("voice")
  ) {
    return "audio";
  }
  if (getTextFromMessage(message) || data?.text || data?.body) return "text";
  if (message?.documentMessage || explicitType.includes("document")) return "document";
  return "unsupported";
}

function getMediaNode(message, type) {
  if (type === "image") return message?.imageMessage || {};
  if (type === "audio") return message?.audioMessage || {};
  if (type === "document") return message?.documentMessage || {};
  return {};
}

function findNestedMediaValue(value, wantedKeys) {
  if (!value || typeof value !== "object") return "";
  const stack = [value];
  const seen = new Set();

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    for (const key of wantedKeys) {
      const candidate = current[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }

    for (const nested of Object.values(current)) {
      if (nested && typeof nested === "object") stack.push(nested);
    }
  }

  return "";
}

function getMediaHints(update, message, mediaNode) {
  const base64 = firstDefined(
    mediaNode?.base64,
    update?.base64,
    update?.data?.base64,
    update?.data?.message?.base64,
    update?.data?.media?.base64,
    findNestedMediaValue(update, ["base64", "mediaBase64"]),
  );
  const url = firstDefined(
    mediaNode?.url,
    mediaNode?.mediaUrl,
    update?.mediaUrl,
    update?.data?.mediaUrl,
    update?.data?.url,
    findNestedMediaValue(update, ["mediaUrl", "downloadUrl"]),
  );

  return { base64, url };
}

function parseFileLength(value) {
  if (value && typeof value === "object") {
    const low = Number(value.low || 0);
    const high = Number(value.high || 0);
    const computed = low + high * 4294967296;
    return Number.isFinite(computed) ? computed : 0;
  }

  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeWhatsAppPayload(update) {
  const { data, message, key } = getMessageParts(update);
  const remoteJid = firstDefined(key.remoteJid, data?.remoteJid, update?.remoteJid, data?.sender, data?.from);
  const messageId = firstDefined(key.id, data?.id, update?.id, data?.messageId);
  const fromMe = Boolean(firstDefined(key.fromMe, data?.fromMe, update?.fromMe, false));
  const text = String(getTextFromMessage(message) || data?.text || data?.body || "").trim();
  const eventName = String(update?.event || update?.type || "").toUpperCase();
  const type = detectMessageType(message, data);
  const isGroup = String(remoteJid || "").endsWith("@g.us");
  const mediaNode = getMediaNode(message, type);
  const mediaHints = getMediaHints(update, message, mediaNode);
  const mimeType = firstDefined(mediaNode?.mimetype, mediaNode?.mimeType, data?.mimetype, data?.mimeType);
  const fileName = firstDefined(
    mediaNode?.fileName,
    data?.fileName,
    type === "audio" ? `whatsapp-audio-${messageId || Date.now()}.ogg` : `whatsapp-image-${messageId || Date.now()}.jpg`,
  );
  const fileSize = parseFileLength(firstDefined(mediaNode?.fileLength, mediaNode?.fileSize, data?.fileLength, data?.fileSize));

  if (eventName && !eventName.includes("MESSAGES_UPSERT") && !eventName.includes("MESSAGE")) return null;
  if (!remoteJid || String(remoteJid).includes("status@broadcast")) return null;
  if (isGroup) return null;
  if (fromMe && type === "text" && !isCommandText(text)) return null;
  if (type === "text" && !text) return null;

  const number = fromMe
    ? process.env.PERSONAL_WHATSAPP_OWNER_NUMBER || normalizeRemoteJid(remoteJid)
    : getReplyTargetNumber(key, data, update);
  if (!number) return null;

  return {
    messageId: String(messageId || `${remoteJid}:${Date.now()}`),
    chatId: String(remoteJid),
    number,
    userName: data?.pushName || update?.pushName || "Usuário",
    text,
    type: fromMe && type === "text" && isCommandText(text) ? "owner_command" : type,
    fromMe,
    isGroup,
    key,
    rawMessage: message,
    media: {
      base64: mediaHints.base64,
      url: mediaHints.url,
      mimeType: String(mimeType || (type === "audio" ? "audio/ogg" : "image/jpeg")),
      fileName: String(fileName),
      fileSize,
      caption: text,
    },
  };
}

function alreadyProcessed(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  for (const [id, timestamp] of processedMessages.entries()) {
    if (now - timestamp > SESSION_TTL_MS) processedMessages.delete(id);
  }

  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, now);
  return false;
}

function getSession(chatId, agent) {
  const key = String(chatId);
  const now = Date.now();
  const current = sessions.get(key);

  if (current && now - current.updatedAt < SESSION_TTL_MS) {
    current.messages[0] = { role: "system", content: renderWhatsappSystemPrompt(agent, agent?.knowledge || []) };
    return current;
  }

  const fresh = {
    updatedAt: now,
    messages: [
      {
        role: "system",
        content: renderWhatsappSystemPrompt(agent, agent?.knowledge || []),
      },
    ],
  };

  sessions.set(key, fresh);
  return fresh;
}

function remember(chatId, role, content, agent) {
  const session = getSession(chatId, agent);
  session.updatedAt = Date.now();
  session.messages.push({ role, content });

  const system = session.messages[0];
  const recent = session.messages.slice(1).slice(-MAX_HISTORY_MESSAGES);
  session.messages = [system, ...recent];
}

async function askOpenRouter({ req, chatId, userName, text, agent }) {
  const apiKey = getOpenRouterKey();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY não configurada.");

  remember(chatId, "user", `${userName}: ${text}`, agent);
  const session = getSession(chatId, agent);
  const activeModel = agent?.model || getModel();

  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getEvolutionConfig(req).appUrl,
      "X-Title": process.env.APP_NAME || "Minha IA",
    },
    body: JSON.stringify({
      model: activeModel,
      temperature: Number(agent?.temperature ?? process.env.AI_TEMPERATURE ?? 0.4),
      max_tokens: Number(agent?.max_tokens ?? process.env.AI_MAX_TOKENS ?? 4096),
      messages: session.messages,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || "OpenRouter não conseguiu responder agora.");

  const answer = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("A IA retornou uma resposta vazia.");

  remember(chatId, "assistant", answer, agent);
  return answer;
}

async function callOpenRouterChat({ req, model, messages, temperature = 0.3, maxTokens = 1800 }) {
  const apiKey = getOpenRouterKey();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY não configurada.");

  const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getEvolutionConfig(req).appUrl,
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
  if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter não conseguiu responder com ${model}.`);

  const answer = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error(`O modelo ${model} retornou uma resposta vazia.`);
  return answer;
}

async function askOpenRouterWithVision({ req, chatId, userName, caption, imageDataUrl, agent }) {
  const session = getSession(chatId, agent);
  session.updatedAt = Date.now();

  const prompt = [
    caption ? `Pedido/legenda do usuário: ${caption}` : "Faça a análise desta imagem enviada pelo usuário.",
    "Descreva o que aparece, leia textos visiveis, destaque informações importantes e responda de forma útil em português do Brasil.",
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

  const modelCandidates = uniqueValues([
    process.env.WHATSAPP_IMAGE_MODEL,
    process.env.AI_VISION_MODEL,
    ...WHATSAPP_IMAGE_MODELS,
  ]);

  let lastError;
  for (const model of modelCandidates) {
    try {
      const answer = await callOpenRouterChat({ req, model, messages, temperature: 0.25, maxTokens: 1800 });
      remember(chatId, "user", `${userName}: enviou uma imagem. ${caption ? `Legenda: ${caption}` : ""}`.trim(), agent);
      remember(chatId, "assistant", answer, agent);
      return answer;
    } catch (error) {
      lastError = error;
      console.error("whatsapp image model error", model, error);
    }
  }

  throw lastError || new Error("Nenhum modelo com visao conseguiu analisar a imagem.");
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
  return "ogg";
}

function usesOpenRouterTranscriptionEndpoint(baseUrl) {
  return String(baseUrl || "").includes("openrouter.ai");
}

async function transcribeWhatsAppAudio({ audioBuffer, fileName, mimeType }) {
  const config = getAudioTranscriptionConfig();
  if (!config.apiKey) {
    return { text: "", model: config.model, error: "Transcrição de áudio não configurada. Defina OPENROUTER_API_KEY." };
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

  const bytes = new Uint8Array(audioBuffer.length);
  bytes.set(audioBuffer);
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: mimeType || "audio/ogg" }), fileName);
  formData.append("model", config.model);
  formData.append("language", "pt");
  formData.append("response_format", "json");
  formData.append("prompt", "Transcreva em português do Brasil quando o áudio estiver em português. Preserve nomes, números, datas e pedidos de lembrete.");

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://minha-ia-orquestrador.vercel.app",
      "X-Title": process.env.APP_NAME || "Minha IA",
    },
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { text: "", model: config.model, error: payload?.error?.message || "Falha ao transcrever áudio." };
  }

  return { text: String(payload?.text || "").trim(), model: config.model, error: "" };
}

async function askFromTranscribedAudio({ req, chatId, userName, transcription, caption, agent }) {
  const prompt = [
    caption ? `Instrucao/legenda do usuário: ${caption}` : null,
    "Transcrição do áudio enviado pelo WhatsApp:",
    transcription,
    "",
    "Responda ao conteúdo do áudio de forma útil.",
  ]
    .filter(Boolean)
    .join("\n");

  return askOpenRouter({ req, chatId, userName, text: prompt, agent });
}

async function evolutionFetch(path, init = {}) {
  const config = getEvolutionConfig({ headers: {} });
  if (!config.apiKey) throw new Error("EVOLUTION_API_KEY não configurada.");

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: config.apiKey,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Evolution API respondeu ${response.status}.`);
  return payload;
}

function base64ToBuffer(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const match = raw.match(/^data:([^;]+);base64,(.+)$/i);
  const base64 = match ? match[2] : raw;
  const mimeType = match ? match[1] : "";

  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) return null;
  return {
    buffer: Buffer.from(base64.replace(/\s/g, ""), "base64"),
    mimeType,
  };
}

function extractMediaBase64(payload) {
  if (typeof payload === "string") return payload;

  return firstDefined(
    payload?.base64,
    payload?.data?.base64,
    payload?.media?.base64,
    payload?.message?.base64,
    payload?.result?.base64,
    payload?.file?.base64,
    payload?.data,
  );
}

async function downloadFromUrl(url, maxBytes) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Não foi possível baixar a mídia do WhatsApp.");

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) throw new Error("Midia muito grande para processar.");

  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get("content-type") || "",
  };
}

async function downloadWhatsAppMedia(parsed, maxBytes) {
  const directBase64 = base64ToBuffer(parsed.media?.base64);
  if (directBase64?.buffer?.length) {
    if (directBase64.buffer.length > maxBytes) throw new Error("Midia muito grande para processar.");
    return directBase64;
  }

  const instance = process.env.WHATSAPP_INSTANCE_NAME || "minha-ia";
  let payload = null;
  try {
    payload = await evolutionFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          key: parsed.key,
        },
        convertToMp4: false,
      }),
    });
  } catch (error) {
    console.error("whatsapp getBase64FromMediaMessage error", error);
  }

  const fetchedBase64 = base64ToBuffer(extractMediaBase64(payload));
  if (!fetchedBase64?.buffer?.length) {
    if (/^https?:\/\//i.test(parsed.media?.url || "") && !String(parsed.media.url).includes("mmg.whatsapp.net")) {
      return downloadFromUrl(parsed.media.url, maxBytes);
    }

    throw new Error("Evolution API não retornou a mídia em base64.");
  }
  if (fetchedBase64.buffer.length > maxBytes) throw new Error("Midia muito grande para processar.");
  return fetchedBase64;
}

async function sendWhatsAppText(number, text) {
  const instance = process.env.WHATSAPP_INSTANCE_NAME || "minha-ia";
  const chunks = splitMessage(text);

  for (const chunk of chunks) {
    await evolutionFetch(`/message/sendText/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({
        number,
        text: chunk,
        delay: 400,
        linkPreview: true,
      }),
    });
  }
}

function splitMessage(text) {
  const limit = 3500;
  const chunks = [];
  let remaining = String(text || "").trim();
  while (remaining.length > limit) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }
  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : ["Não consegui gerar uma resposta agora."];
}

async function handleWhatsAppAudio({ req, parsed, agent }) {
  if (parsed.media.fileSize > MAX_WHATSAPP_AUDIO_BYTES) {
    await sendWhatsAppText(parsed.number, "Esse áudio ficou grande demais para eu processar agora. Tente enviar um áudio menor.");
    return;
  }

  const media = await downloadWhatsAppMedia(parsed, MAX_WHATSAPP_AUDIO_BYTES);
  const transcription = await transcribeWhatsAppAudio({
    audioBuffer: media.buffer,
    fileName: parsed.media.fileName,
    mimeType: media.mimeType || parsed.media.mimeType,
  });

  if (!transcription.text) {
    throw new Error(transcription.error || "Whisper não retornou transcrição.");
  }

  const answer = await askFromTranscribedAudio({
    req,
    chatId: parsed.chatId,
    userName: parsed.userName,
    transcription: transcription.text,
    caption: parsed.media.caption,
    agent,
  });

  await sendWhatsAppText(parsed.number, `🎤 Você disse: ${transcription.text}\n\n${answer}`);
}

async function handleWhatsAppImage({ req, parsed, agent }) {
  if (parsed.media.fileSize > MAX_WHATSAPP_IMAGE_BYTES) {
    await sendWhatsAppText(parsed.number, "Essa imagem ficou grande demais para eu analisar agora. Tente enviar uma imagem menor.");
    return;
  }

  const media = await downloadWhatsAppMedia(parsed, MAX_WHATSAPP_IMAGE_BYTES);
  const mimeType = media.mimeType || parsed.media.mimeType || "image/jpeg";
  const imageDataUrl = `data:${mimeType};base64,${media.buffer.toString("base64")}`;
  const answer = await askOpenRouterWithVision({
    req,
    chatId: parsed.chatId,
    userName: parsed.userName,
    caption: parsed.media.caption,
    imageDataUrl,
    agent,
  });

  await sendWhatsAppText(parsed.number, `🖼️ Sobre a imagem:\n\n${answer}`);
}

async function handleWhatsAppKnowledgeAudio({ req, parsed, agent }) {
  if (!agent?.id) {
    await sendWhatsAppText(parsed.number, "Escolha um agente ativo no WhatsApp antes de cadastrar produtos ou medicamentos.");
    return;
  }
  if (parsed.media.fileSize > MAX_WHATSAPP_AUDIO_BYTES) {
    await sendWhatsAppText(parsed.number, "Esse áudio ficou grande demais para eu processar agora. Tente enviar um áudio menor.");
    return;
  }

  const media = await downloadWhatsAppMedia(parsed, MAX_WHATSAPP_AUDIO_BYTES);
  const transcription = await transcribeWhatsAppAudio({
    audioBuffer: media.buffer,
    fileName: parsed.media.fileName,
    mimeType: media.mimeType || parsed.media.mimeType,
  });

  if (!transcription.text) {
    throw new Error(transcription.error || "Whisper não retornou transcrição.");
  }

  const context = stripWhatsappKnowledgeCommand(parsed.media.caption || "");
  const extracted = await extractKnowledgeFromText({
    req,
    text: transcription.text,
    context,
    agent,
  });
  const draft = await createKnowledgeDraft({
    agent,
    extracted,
    channel: "whatsapp",
    chatId: parsed.chatId,
    messageId: parsed.messageId,
    mediaType: "audio",
    rawText: transcription.text,
  });

  if (!draft) {
    await sendWhatsAppText(parsed.number, "Não consegui salvar o rascunho agora. Verifique as variaveis do Supabase e tente novamente.");
    return;
  }

  await sendWhatsAppText(
    parsed.number,
    `🎤 Você disse: ${transcription.text}\n\n${renderKnowledgeDraftPreview({ agent, draft })}`,
  );
}

async function handleWhatsAppKnowledgeImage({ req, parsed, agent }) {
  if (!agent?.id) {
    await sendWhatsAppText(parsed.number, "Escolha um agente ativo no WhatsApp antes de cadastrar produtos ou medicamentos.");
    return;
  }
  if (parsed.media.fileSize > MAX_WHATSAPP_IMAGE_BYTES) {
    await sendWhatsAppText(parsed.number, "Essa imagem ficou grande demais para eu analisar agora. Tente enviar uma imagem menor.");
    return;
  }

  const media = await downloadWhatsAppMedia(parsed, MAX_WHATSAPP_IMAGE_BYTES);
  const mimeType = media.mimeType || parsed.media.mimeType || "image/jpeg";
  const imageDataUrl = `data:${mimeType};base64,${media.buffer.toString("base64")}`;
  const caption = stripWhatsappKnowledgeCommand(parsed.media.caption || "");
  const extracted = await extractKnowledgeFromImage({
    req,
    imageDataUrl,
    caption,
    agent,
  });
  const draft = await createKnowledgeDraft({
    agent,
    extracted,
    channel: "whatsapp",
    chatId: parsed.chatId,
    messageId: parsed.messageId,
    mediaType: "image",
    rawText: caption,
  });

  if (!draft) {
    await sendWhatsAppText(parsed.number, "Não consegui salvar o rascunho agora. Verifique as variaveis do Supabase e tente novamente.");
    return;
  }

  await sendWhatsAppText(parsed.number, `🖼️ Imagem analisada para cadastro.\n\n${renderKnowledgeDraftPreview({ agent, draft })}`);
}

async function handleWhatsappKnowledgeCommand({ parsed, runtime }) {
  const command = normalizeText(parsed.text);
  if (command === "#cadastrar") {
    return armWhatsappKnowledgeCapture(runtime, parsed);
  }

  const correction = parseWhatsappCorrectionCommand(parsed.text);
  if (correction) {
    const draft = await findPendingKnowledgeDraft("whatsapp");
    if (!draft) return "Não encontrei rascunho pendente para corrigir.";
    const updated = await patchKnowledgeDraft(draft.id, applyKnowledgeCorrection(draft, correction));
    if (!updated) return "Não consegui aplicar a correcao agora. Tente novamente.";
    return renderKnowledgeDraftPreview({ agent: { name: updated.metadata?.agent_name || "Agente ativo" }, draft: updated });
  }

  if (command === "#aprovar" || command === "#descartar") {
    const draft = await findPendingKnowledgeDraft("whatsapp");
    if (!draft) return "Não encontrei rascunho pendente.";
    const approving = command === "#aprovar";
    const updated = await patchKnowledgeDraft(draft.id, {
      is_active: approving,
      metadata: {
        ...(draft.metadata || {}),
        status: approving ? "approved" : "discarded",
        reviewed_at: new Date().toISOString(),
        reviewed_by: "whatsapp_owner",
      },
    });
    if (!updated) return "Não consegui atualizar o rascunho agora. Tente novamente.";
    whatsappRuntimeCache.delete(`${getSupabaseServiceConfig().ownerUserId}:whatsapp-runtime`);
    return approving
      ? `Cadastro aprovado e liberado para o agente usar.\n\nItem: ${updated.title}`
      : `Rascunho descartado.\n\nItem: ${updated.title}`;
  }

  return "";
}

function reminderCaptureState(preferences) {
  return preferences?.reminderCapture?.whatsapp || null;
}

function isWhatsappReminderCaptureActive(runtime, parsed) {
  const capture = reminderCaptureState(runtime.preferences);
  if (!capture?.expiresAt || String(capture.chatId || "") !== String(parsed.chatId || "")) return false;
  return new Date(capture.expiresAt).getTime() > Date.now();
}

async function armWhatsappReminderCapture(runtime, parsed) {
  const current = runtime.preferences?.reminderCapture || {};
  await updateWhatsappPreferences({
    reminderCapture: {
      ...current,
      whatsapp: {
        chatId: parsed.chatId,
        expiresAt: new Date(Date.now() + KNOWLEDGE_CAPTURE_TTL_MS).toISOString(),
      },
    },
  });
  return "Modo lembrete ativado por 10 minutos. Envie um áudio ou texto com o que devo lembrar e o horário. Ex: pagar boleto amanhã às 9h.";
}

async function clearWhatsappReminderCapture(runtime) {
  const current = runtime.preferences?.reminderCapture || {};
  await updateWhatsappPreferences({
    reminderCapture: {
      ...current,
      whatsapp: {
        ...(current.whatsapp || {}),
        expiresAt: new Date(0).toISOString(),
      },
    },
  });
}

async function createWhatsappReminder({ text }) {
  if (!hasWhatsappAgentServiceConfig()) {
    return { ok: false, error: "Para criar lembretes pelo WhatsApp, configure SUPABASE_SERVICE_ROLE_KEY e WHATSAPP_OWNER_USER_ID no Vercel." };
  }

  const cleanText = extractReminderText(text);
  if (!cleanText || cleanText.length < 3) {
    return { ok: false, error: "Me diga o que devo lembrar. Ex: #lembrar pagar boleto amanhã às 9h." };
  }

  const nextRunAt = inferReminderDateFromText(text);
  if (!nextRunAt) {
    return { ok: false, error: "Não consegui identificar data e horário. Ex: #lembrar pagar boleto amanhã às 9h ou #lembrar tomar remédio em 30 minutos." };
  }

  const recurrence = parseReminderRecurrence(text);
  const title = cleanText.length > 100 ? `${cleanText.slice(0, 97)}...` : cleanText;
  const config = getSupabaseServiceConfig();
  const rows = await supabaseServicePost("scheduled_tasks", {
    user_id: config.ownerUserId,
    title,
    prompt: cleanText,
    recurrence: recurrence ? "hourly" : "custom",
    cron_expression: "reminder",
    next_run_at: nextRunAt,
    is_active: true,
    notification_channels: ["whatsapp", "telegram"],
    notification_status: "pending",
    metadata: {
      reminder: {
        source: "whatsapp",
        ackRequired: true,
        awaitingAck: false,
        snoozeMinutes: REMINDER_ACK_SNOOZE_MINUTES,
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

async function findAwaitingReminderAcks() {
  const config = getSupabaseServiceConfig();
  const rows = await supabaseServiceGet(
    `scheduled_tasks?user_id=eq.${encodeURIComponent(config.ownerUserId)}&cron_expression=eq.reminder&is_active=eq.true&select=id,title,prompt,next_run_at,metadata&order=next_run_at.asc&limit=20`,
  );
  return (Array.isArray(rows) ? rows : []).filter((task) => task?.metadata?.reminder?.awaitingAck === true);
}

async function listActiveWhatsappReminders() {
  if (!hasWhatsappAgentServiceConfig()) {
    return "Não consegui listar lembretes agora porque a configuração do Supabase não está completa.";
  }

  const config = getSupabaseServiceConfig();
  const rows = await supabaseServiceGet(
    `scheduled_tasks?user_id=eq.${encodeURIComponent(config.ownerUserId)}&cron_expression=eq.reminder&is_active=eq.true&select=id,title,prompt,next_run_at,notification_status,metadata&order=next_run_at.asc&limit=20`,
  );
  const tasks = Array.isArray(rows) ? rows : [];

  if (!tasks.length) {
    return "Você não tem lembretes ativos agora.";
  }

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
    "Para cancelar: #cancelar lembrete nome do lembrete",
    "Para cancelar todos: #cancelar todos",
  ].join("\n");
}

function parseCancelReminderCommand(text) {
  const raw = String(text || "").trim();
  const normalized = normalizeText(raw);
  if (normalized === "#cancelar todos") return { all: true, query: "" };
  if (normalized === "#cancelar") return { all: false, query: "" };

  const query = raw
    .replace(/^#cancelar\s*/i, "")
    .replace(/^lembrete\s*/i, "")
    .trim();
  return { all: false, query };
}

function reminderMatchesQuery(task, query) {
  const needle = normalizeText(query);
  if (!needle) return false;
  const haystack = normalizeText(`${task.title || ""} ${task.prompt || ""}`);
  return haystack.includes(needle) || needle.includes(normalizeText(task.title || ""));
}

async function cancelWhatsappReminders(commandText) {
  if (!hasWhatsappAgentServiceConfig()) {
    return "Não consegui cancelar lembretes agora porque a configuração do Supabase não está completa.";
  }

  const parsed = parseCancelReminderCommand(commandText);
  if (!parsed.all && !parsed.query) {
    return [
      "Me diga qual lembrete devo cancelar.",
      "",
      "Exemplos:",
      "#cancelar lembrete beber água",
      "#cancelar todos",
    ].join("\n");
  }

  const config = getSupabaseServiceConfig();
  const rows = await supabaseServiceGet(
    `scheduled_tasks?user_id=eq.${encodeURIComponent(config.ownerUserId)}&cron_expression=eq.reminder&is_active=eq.true&select=id,title,prompt,next_run_at,metadata&order=next_run_at.asc&limit=50`,
  );
  const tasks = Array.isArray(rows) ? rows : [];

  if (!tasks.length) {
    return "Você não tem lembretes ativos para cancelar.";
  }

  const selected = parsed.all ? tasks : tasks.filter((task) => reminderMatchesQuery(task, parsed.query));
  if (!selected.length) {
    return [
      `Não encontrei lembrete ativo com: ${parsed.query}`,
      "",
      "Use #lembretes para ver os lembretes ativos.",
    ].join("\n");
  }

  const nowIso = new Date().toISOString();
  const cancelled = [];
  for (const task of selected) {
    const reminder = task.metadata?.reminder || {};
    const patch = {
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
          canceledBy: "whatsapp_owner",
        },
      },
    };

    const updated = await supabaseServicePatch(
      `scheduled_tasks?id=eq.${encodeURIComponent(task.id)}&user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
      patch,
    );
    if (Array.isArray(updated) && updated.length) {
      cancelled.push(task);
      await supabaseServicePost("task_executions", {
        user_id: config.ownerUserId,
        scheduled_task_id: task.id,
        status: "success",
        output: "Lembrete cancelado pelo dono via WhatsApp.",
        finished_at: nowIso,
      });
    }
  }

  if (!cancelled.length) {
    return "Encontrei o lembrete, mas não consegui cancelar agora. Tente novamente.";
  }

  const names = cancelled.slice(0, 8).map((task) => `- ${task.title}`).join("\n");
  const suffix = cancelled.length > 8 ? `\n- e mais ${cancelled.length - 8}` : "";
  return [
    cancelled.length === 1 ? "Lembrete cancelado:" : `${cancelled.length} lembretes cancelados:`,
    names + suffix,
  ].join("\n");
}

async function acknowledgeWhatsappReminders() {
  if (!hasWhatsappAgentServiceConfig()) {
    return "Não consegui confirmar agora porque a configuração do Supabase não está completa.";
  }

  const config = getSupabaseServiceConfig();
  const tasks = await findAwaitingReminderAcks();
  if (!tasks.length) {
    return "Não encontrei lembrete aguardando confirmação agora.";
  }

  const nowIso = new Date().toISOString();
  const summaries = [];

  for (const task of tasks) {
    const reminder = task.metadata?.reminder || {};
    const intervalMinutes = Number(reminder.intervalMinutes || 0);
    const isRecurring = Boolean(reminder.recurring && Number.isFinite(intervalMinutes) && intervalMinutes > 0);
    const nextRunAt = isRecurring ? nextIsoAfterMinutes(intervalMinutes) : task.next_run_at;
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
      ? {
          next_run_at: nextRunAt,
          notification_status: "pending",
          notification_error: null,
          notified_at: null,
          metadata,
        }
      : {
          is_active: false,
          last_status: "success",
          notification_status: "sent",
          notification_error: null,
          notified_at: nowIso,
          metadata,
        };

    await supabaseServicePatch(`scheduled_tasks?id=eq.${encodeURIComponent(task.id)}&user_id=eq.${encodeURIComponent(config.ownerUserId)}`, patch);
    await supabaseServicePost("task_executions", {
      user_id: config.ownerUserId,
      scheduled_task_id: task.id,
      status: "success",
      output: "Lembrete confirmado pelo dono via WhatsApp.",
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

async function handleWhatsappReminderText({ parsed, runtime }) {
  const directText = isReminderCommandText(parsed.text) ? stripReminderCommand(parsed.text) : parsed.text;
  if (!directText.trim()) return armWhatsappReminderCapture(runtime, parsed);

  const result = await createWhatsappReminder({ text: parsed.text });
  if (!result.ok) return result.error;
  await clearWhatsappReminderCapture(runtime);
  return formatReminderConfirmation(result.task);
}

async function handleWhatsappReminderAudio({ parsed, runtime }) {
  if (parsed.media.fileSize > MAX_WHATSAPP_AUDIO_BYTES) {
    return "Esse áudio ficou grande demais para criar lembrete. Tente enviar um áudio menor.";
  }

  const media = await downloadWhatsAppMedia(parsed, MAX_WHATSAPP_AUDIO_BYTES);
  const transcription = await transcribeWhatsAppAudio({
    audioBuffer: media.buffer,
    fileName: parsed.media.fileName || "whatsapp-reminder.ogg",
    mimeType: media.mimeType || parsed.media.mimeType || "audio/ogg",
  });
  if (!transcription.text) {
    return "Recebi seu áudio, mas não consegui transcrever agora. Tente enviar por texto ou reenviar o áudio.";
  }

  const result = await createWhatsappReminder({ text: transcription.text });
  if (!result.ok) return `🎤 Você disse: ${transcription.text}\n\n${result.error}`;
  await clearWhatsappReminderCapture(runtime);
  return `🎤 Você disse: ${transcription.text}\n\n${formatReminderConfirmation(result.task)}`;
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      name: "Minha IA WhatsApp webhook",
      evolutionConfigured: Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
      instance: process.env.WHATSAPP_INSTANCE_NAME || "minha-ia",
      aiConfigured: Boolean(getOpenRouterKey()),
      model: getModel(),
      whatsappAgentSelectionConfigured: hasWhatsappAgentServiceConfig(),
      botPauseSupported: hasWhatsappAgentServiceConfig(),
      personalAgentSupported: true,
      personalAgentModel: getPersonalModel(),
      telegramOwnerConfigured: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID),
      personalOwnerNumberConfigured: Boolean(process.env.PERSONAL_WHATSAPP_OWNER_NUMBER),
      ownerCommandsFromConnectedDeviceSupported: true,
      knowledgeRegistration: true,
      reminderRegistration: {
        text: true,
        naturalText: true,
        audioAfterCommand: true,
        recurring: true,
        ackRequired: true,
        listCommand: "#lembretes",
        cancelCommand: "#cancelar lembrete nome",
        command: "#lembrar",
      },
      audioTranscriptionModel: getAudioTranscriptionConfig().model,
      media: {
        audio: true,
        image: true,
      },
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Método não permitido." });
  }

  const update = parseBody(req.body);
  const parsed = normalizeWhatsAppPayload(update);

  if (!parsed) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  if (alreadyProcessed(parsed.messageId)) {
    return res.status(200).json({ ok: true, duplicate: true });
  }

  try {
    const whatsappRuntime = await loadWhatsappRuntimeConfig();
    const command = normalizeText(parsed.text);

    if (isCommandText(parsed.text)) {
      if (!isOwnerCommandAuthorized(parsed)) {
        return res.status(200).json({ ok: true, ownerCommandIgnored: true });
      }

      if (isReminderAckText(parsed.text)) {
        const responseText = await acknowledgeWhatsappReminders();
        if (parsed.number) await sendWhatsAppText(parsed.number, responseText);
        await sendTelegramOwnerNotification(responseText);
        return res.status(200).json({ ok: true, reminderAck: true });
      }

      if (command === "#lembretes") {
        const responseText = await listActiveWhatsappReminders();
        if (parsed.number) await sendWhatsAppText(parsed.number, responseText);
        await sendTelegramOwnerNotification(responseText);
        return res.status(200).json({ ok: true, reminderList: true });
      }

      if (command === "#cancelar" || command === "#cancelar todos" || command.startsWith("#cancelar ")) {
        const responseText = await cancelWhatsappReminders(parsed.text);
        if (parsed.number) await sendWhatsAppText(parsed.number, responseText);
        await sendTelegramOwnerNotification(responseText);
        return res.status(200).json({ ok: true, reminderCancel: true });
      }

      if (isWhatsappKnowledgeCommandText(parsed.text)) {
        if (!isOwnerCommandAuthorized(parsed)) {
          return res.status(200).json({ ok: true, knowledgeCommandIgnored: true });
        }
        const responseText = await handleWhatsappKnowledgeCommand({ parsed, runtime: whatsappRuntime });
        if (responseText) {
          if (parsed.number) await sendWhatsAppText(parsed.number, responseText);
          await sendTelegramOwnerNotification(responseText);
        }
        return res.status(200).json({ ok: true, knowledgeCommand: true });
      }

      if (isReminderCommandText(parsed.text) || looksLikeReminderRequest(parsed.text)) {
        const responseText = await handleWhatsappReminderText({ parsed, runtime: whatsappRuntime });
        if (parsed.number) await sendWhatsAppText(parsed.number, responseText);
        await sendTelegramOwnerNotification(responseText);
        return res.status(200).json({ ok: true, reminderCommand: true });
      }

      if (command !== "#pausar" && command !== "#ativar") {
        return res.status(200).json({ ok: true, ownerCommandIgnored: true });
      }

      const enabled = command === "#ativar";
      await updateWhatsappPreferences({
        whatsappBotEnabled: enabled,
        personalAgentEnabled: enabled,
      });

      const responseText = enabled
        ? "Agente pessoal ativado. Vou voltar a responder suas mensagens."
        : "Agente pessoal pausado. Vou ficar em modo manual.";
      await sendTelegramOwnerNotification(responseText);
      if (!parsed.fromMe && parsed.number) await sendWhatsAppText(parsed.number, responseText);
      await logPersonalMessage({
        parsed,
        classification: {
          classification: "command",
          urgencyScore: 0,
          isVip: false,
          isSpam: false,
          notificationReason: "comando secreto do dono",
        },
        responseText,
        ownerNotified: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID),
        metadata: { command, enabled },
      });
      return res.status(200).json({ ok: true, ownerCommand: true, enabled });
    }

    const whatsappAgent = whatsappRuntime.agent
      ? { ...whatsappRuntime.agent, knowledge: whatsappRuntime.knowledge || [] }
      : null;
    const personalAgentEnabled = whatsappRuntime.preferences?.personalAgentEnabled !== false;
    const knowledgeCaption = parsed.media?.caption || "";
    const activeKnowledgeCapture = captureState(whatsappRuntime.preferences, "whatsapp");
    const capturedKnowledgeAgent = activeKnowledgeCapture?.agentId && String(activeKnowledgeCapture.chatId) === String(parsed.chatId)
      ? await loadWhatsappAgentById(activeKnowledgeCapture.agentId, getSupabaseServiceConfig().ownerUserId)
      : null;
    const whatsappKnowledgeAgent = capturedKnowledgeAgent || whatsappRuntime.knowledgeAgent || whatsappRuntime.agent;
    const shouldRegisterKnowledgeMedia =
      isOwnerCommandAuthorized(parsed) &&
      (isWhatsappKnowledgeRegisterText(knowledgeCaption) || isWhatsappKnowledgeCaptureActive(whatsappRuntime, parsed));

    if (parsed.type === "audio" && shouldRegisterKnowledgeMedia) {
      await handleWhatsAppKnowledgeAudio({ req, parsed, agent: whatsappKnowledgeAgent });
      return res.status(200).json({ ok: true, knowledgeAudio: true });
    }

    if (parsed.type === "image" && shouldRegisterKnowledgeMedia) {
      await handleWhatsAppKnowledgeImage({ req, parsed, agent: whatsappKnowledgeAgent });
      return res.status(200).json({ ok: true, knowledgeImage: true });
    }

    if (isOwnerCommandAuthorized(parsed) && isWhatsappReminderCaptureActive(whatsappRuntime, parsed)) {
      const responseText = parsed.type === "audio"
        ? await handleWhatsappReminderAudio({ parsed, runtime: whatsappRuntime })
        : parsed.type === "text" && looksLikeReminderRequest(parsed.text)
          ? await handleWhatsappReminderText({ parsed, runtime: whatsappRuntime })
          : "Envie um áudio ou texto de lembrete com data e horário. Ex: tomar remédio amanhã às 8h.";
      if (parsed.number) await sendWhatsAppText(parsed.number, responseText);
      await sendTelegramOwnerNotification(responseText);
      return res.status(200).json({ ok: true, reminderCapture: true });
    }

    if (parsed.fromMe) {
      return res.status(200).json({ ok: true, ownerMessageIgnored: true });
    }

    if (!whatsappRuntime.botEnabled) {
      return res.status(200).json({ ok: true, paused: true });
    }

    if (!personalAgentEnabled && whatsappAgent && !isWithinAgentSchedule(whatsappAgent)) {
      await sendWhatsAppText(parsed.number, getAgentOutOfHoursMessage(whatsappAgent));
      return res.status(200).json({ ok: true, agentOutOfHours: true });
    }

    if (parsed.type === "audio") {
      await handleWhatsAppAudio({ req, parsed, agent: whatsappAgent });
      return res.status(200).json({ ok: true, audio: true });
    }

    if (parsed.type === "image") {
      await handleWhatsAppImage({ req, parsed, agent: whatsappAgent });
      return res.status(200).json({ ok: true, image: true });
    }

    if (parsed.type !== "text") {
      await sendWhatsAppText(
        parsed.number,
        "Recebi esse arquivo, mas por enquanto eu analiso automaticamente mensagens de texto, áudios e fotos pelo WhatsApp.",
      );
      return res.status(200).json({ ok: true, unsupported: true });
    }

    if (personalAgentEnabled) {
      const result = await handlePersonalText({ req, parsed, runtime: whatsappRuntime });
      return res.status(200).json({ ok: true, personal: true, ...result });
    }

    const answer = await askOpenRouter({ req, ...parsed, agent: whatsappAgent });
    await sendWhatsAppText(parsed.number, answer);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("whatsapp webhook error", error);
    try {
      await sendWhatsAppText(parsed.number, "Desculpa, não consegui responder agora. Tente novamente em alguns instantes.");
    } catch (sendError) {
      console.error("whatsapp fallback send error", sendError);
    }
    return res.status(200).json({ ok: true, handledWithFallback: true });
  }
}

