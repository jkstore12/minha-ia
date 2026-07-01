import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";
import { DEFAULT_USER_PREFERENCES, parseUserPreferences } from "@/lib/user-preferences";
import { getWhatsAppOwnerContext, loadWhatsAppOwnerPreferences } from "@/lib/whatsapp-owner";

export const runtime = "nodejs";

const DEFAULT_EVOLUTION_API_URL = "https://evolution-api-production-d8ba.up.railway.app";
const PERSONAL_AGENT_MODEL = "~anthropic/claude-sonnet-latest";
const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

const SimulationInput = z.object({
  message: z.string().trim().min(1).max(1200),
  scenario: z.enum(["normal", "vip", "urgent", "outside_hours"]).default("normal"),
});

type AgentRow = {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  system_prompt: string | null;
  tools: string[] | null;
  model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  is_active: boolean | null;
  metadata?: Record<string, unknown> | null;
};

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseList(value: string) {
  return String(value || "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type PersonalProfile = ReturnType<typeof parseUserPreferences>["personalProfile"];

function parseTimeToMinutes(value: string) {
  const match = String(value || "").match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Math.max(0, Math.min(23, Number(match[1] || 0)));
  const minute = Math.max(0, Math.min(59, Number(match[2] || 0)));
  return hour * 60 + minute;
}

function getCurrentTimeParts(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone || "America/Fortaleza",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const weekdayRaw = String(parts.find((part) => part.type === "weekday")?.value || "").toLowerCase();
  const weekdayMap: Record<string, string> = { sun: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat" };
  return {
    weekday: weekdayMap[weekdayRaw.slice(0, 3)] || "mon",
    minutes:
      Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 +
      Number(parts.find((part) => part.type === "minute")?.value || 0),
  };
}

function isWithinPersonalHours(profile: PersonalProfile) {
  const days = profile.availableDays?.length ? profile.availableDays : ["mon", "tue", "wed", "thu", "fri"];
  const start = parseTimeToMinutes(profile.startTime || "08:00");
  const end = parseTimeToMinutes(profile.endTime || "18:00");
  if (start != null && end != null) {
    const current = getCurrentTimeParts(profile.timezone || "America/Fortaleza");
    if (!days.map(String).includes(current.weekday)) return false;
    if (start <= end) return current.minutes >= start && current.minutes <= end;
    return current.minutes >= start || current.minutes <= end;
  }

  const value = normalizeText(profile.availableHours || "");
  const matches = [...value.matchAll(/(\d{1,2})(?::?(\d{2}))?\s*h?/g)];
  if (matches.length < 2) return true;

  const toMinutes = (match: RegExpMatchArray) => {
    const hour = Math.max(0, Math.min(23, Number(match[1] || 0)));
    const minute = Math.max(0, Math.min(59, Number(match[2] || 0)));
    return hour * 60 + minute;
  };

  const legacyStart = toMinutes(matches[0]);
  const legacyEnd = toMinutes(matches[1]);
  const current = getCurrentTimeParts("America/Fortaleza").minutes;

  if (legacyStart <= legacyEnd) return current >= legacyStart && current <= legacyEnd;
  return current >= legacyStart || current <= legacyEnd;
}

function describePersonalSchedule(profile: PersonalProfile) {
  const dayLabels: Record<string, string> = {
    mon: "segunda",
    tue: "terça",
    wed: "quarta",
    thu: "quinta",
    fri: "sexta",
    sat: "sábado",
    sun: "domingo",
  };
  const days = profile.availableDays?.length ? profile.availableDays : ["mon", "tue", "wed", "thu", "fri"];
  return `${days.map((day) => dayLabels[day] || day).join(", ")}, das ${profile.startTime || "08:00"} às ${profile.endTime || "18:00"} (${profile.timezone || "America/Fortaleza"})`;
}

function classifyMessage(message: string, preferences: ReturnType<typeof parseUserPreferences>, scenario: z.infer<typeof SimulationInput>["scenario"]) {
  const text = normalizeText(message);
  const profile = preferences.personalProfile;
  const urgentTopics = parseList(preferences.personalUrgentTopics);
  const urgentPatterns = [
    /\burgente\b/,
    /\bemergência\b/,
    /\bpreciso falar\b/,
    /\bimportante\b/,
    /\bagora\b/,
    /\bme liga\b/,
    /\bliga pra mim\b/,
  ];
  const isFinancial = /\b(pix|dinheiro|pagamento|boleto|banco|cartao|emprestimo|transferencia|cobranca|divida)\b/.test(text);
  const isHealthOrEmergency = /\b(saúde|hospital|medico|emergência|ambulancia|dor no peito|falta de ar|desmaio|acidente|sangramento|gravidez|febre alta)\b/.test(text);
  const isCommitment = /\b(confirmar|confirma|compromisso|reuniao|contrato|assinatura|viagem|consulta|agenda)\b/.test(text);
  const isSpam = /\b(corrente|encaminhe|promocao imperdivel|ganhe dinheiro|clique aqui|sorteio|aposta|bonus|cupom|marketing)\b/.test(text);
  const urgentByTopic = urgentTopics.some((topic) => {
    const normalized = normalizeText(topic);
    return normalized && text.includes(normalized);
  });

  const forcedVip = scenario === "vip";
  const forcedUrgent = scenario === "urgent";
  const withinHours = scenario === "outside_hours" ? false : isWithinPersonalHours(profile);
  const restricted = isFinancial || isHealthOrEmergency || isCommitment;
  const urgent = forcedVip || forcedUrgent || urgentByTopic || urgentPatterns.some((pattern) => pattern.test(text)) || isFinancial || isHealthOrEmergency;

  let classification = "normal";
  if (isSpam && !urgent) classification = "spam";
  else if (restricted) classification = "restricted";
  else if (forcedVip) classification = "vip";
  else if (urgent) classification = "urgent";

  return {
    classification,
    withinHours,
    isVip: forcedVip,
    isSpam,
    restricted,
    notifyOwner: forcedVip || urgent || restricted,
    urgencyScore: Math.min(100, (urgent ? 70 : 0) + (forcedVip ? 20 : 0) + (restricted ? 10 : 0)),
    reason: [
      forcedVip ? "contato VIP" : null,
      forcedUrgent || urgentByTopic || urgentPatterns.some((pattern) => pattern.test(text)) ? "mensagem urgente" : null,
      restricted ? "assunto sensivel" : null,
      !withinHours ? "fora do horário" : null,
      isSpam ? "possível spam" : null,
    ].filter(Boolean).join(", ") || "mensagem comum",
  };
}

function getEvolutionConfig(request: Request) {
  const host = request.headers.get("host") || "minha-ia-orquestrador.vercel.app";
  return {
    baseUrl: (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_API_URL).replace(/\/$/, ""),
    apiKey: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.WHATSAPP_INSTANCE_NAME || "minha-ia",
    appUrl: process.env.NEXT_PUBLIC_APP_URL || `https://${host}`,
  };
}

async function getConnectionState(request: Request) {
  const config = getEvolutionConfig(request);
  if (!config.apiKey) return { configured: false, state: "not_configured", error: "EVOLUTION_API_KEY não configurada." };

  try {
    const response = await fetch(`${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instance)}`, {
      headers: { apikey: config.apiKey, Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    const state =
      payload?.instance?.state ||
      payload?.state ||
      payload?.connectionState ||
      payload?.data?.state ||
      payload?.response?.state ||
      "unknown";
    return {
      configured: true,
      state: String(state),
      ok: response.ok,
      error: response.ok ? "" : String(payload?.message || payload?.error || `Evolution API respondeu ${response.status}.`),
    };
  } catch (error) {
    return {
      configured: true,
      state: "unknown",
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível consultar a Evolution API.",
    };
  }
}

function resolveWhatsAppAgent(preferences: ReturnType<typeof parseUserPreferences>, agents: AgentRow[]) {
  if (preferences.personalAgentEnabled) {
    return {
      id: "personal-whatsapp",
      name: "Agente pessoal do WhatsApp",
      domain: "personal",
      model: PERSONAL_AGENT_MODEL,
      source: "personal",
    };
  }
  const agent = preferences.whatsappAgentId ? agents.find((item) => item.id === preferences.whatsappAgentId) : null;
  return agent
    ? { id: agent.id, name: agent.name, domain: agent.domain, model: agent.model || "modelo padrão", source: "agent" }
    : { id: "", name: "Sem agente ativo", domain: "fallback", model: process.env.AI_MODEL || "openai/gpt-chat-latest", source: "fallback" };
}

function fallbackSimulationResponse(classification: ReturnType<typeof classifyMessage>, preferences?: ReturnType<typeof parseUserPreferences>) {
  if (classification.classification === "spam") return "Nenhuma resposta seria enviada. A mensagem seria tratada como spam/corrente.";
  if (classification.classification === "restricted") return "Recebi sua mensagem. Esse assunto e importante, entao vou ver pessoalmente e te retorno assim que puder.";
  if (!classification.withinHours) return preferences?.personalProfile.outOfHoursMessage || "Oi! Estou ocupado agora, mas retorno assim que puder.";
  return "Oi! Recebi sua mensagem. Vou te responder de forma objetiva e te retorno com o melhor encaminhamento.";
}

async function generateSimulationResponse(input: {
  request: Request;
  message: string;
  agent: ReturnType<typeof resolveWhatsAppAgent>;
  classification: ReturnType<typeof classifyMessage>;
  activeAgent?: AgentRow | null;
  preferences: ReturnType<typeof parseUserPreferences>;
}) {
  if (input.classification.classification === "spam" || input.classification.classification === "restricted" || !input.classification.withinHours) {
    return { text: fallbackSimulationResponse(input.classification, input.preferences), generatedByModel: false };
  }

  const apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) return { text: fallbackSimulationResponse(input.classification, input.preferences), generatedByModel: false };

  const personalProfile = input.preferences.personalProfile;
  const systemPrompt =
    input.activeAgent?.system_prompt ||
    [
      "Você responde o WhatsApp pessoal do dono de forma natural e discreta.",
      "Não revele que é uma IA, exceto se perguntarem diretamente.",
      "Tom casual com amigos e familia; tom profissional com clientes e trabalho.",
      personalProfile.name ? `Nome do dono: ${personalProfile.name}.` : null,
      personalProfile.profession ? `Profissão do dono: ${personalProfile.profession}.` : null,
      `Horário disponível: ${describePersonalSchedule(personalProfile)}.`,
      "Não tome decisões financeiras, não confirme compromissos importantes e não responda orientação de saúde/emergência.",
    ].filter(Boolean).join("\n");

  try {
    const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": getEvolutionConfig(input.request).appUrl,
        "X-Title": process.env.APP_NAME || "Minha IA",
      },
      body: JSON.stringify({
        model: input.agent.model || process.env.AI_MODEL || "openai/gpt-chat-latest",
        temperature: Number(input.activeAgent?.temperature ?? 0.35),
        max_tokens: 500,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              "Simule uma resposta curta de WhatsApp. Não diga que e simulação.",
              `Classificação: ${input.classification.classification}.`,
              `Motivo: ${input.classification.reason}.`,
              `Mensagem recebida: ${input.message}`,
            ].join("\n"),
          },
        ],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    const text = String(payload?.choices?.[0]?.message?.content || "").trim();
    return { text: text || fallbackSimulationResponse(input.classification, input.preferences), generatedByModel: Boolean(text && response.ok) };
  } catch {
    return { text: fallbackSimulationResponse(input.classification, input.preferences), generatedByModel: false };
  }
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const owner = getWhatsAppOwnerContext({ fallbackSupabase: supabase, fallbackUser: user });
  const [ownerProfile, { data: agents }, recentResult, urgentResult] = await Promise.all([
    loadWhatsAppOwnerPreferences(owner).catch(() => ({ preferences: DEFAULT_USER_PREFERENCES, displayName: owner.displayName })),
    owner.supabase
      .from("agents")
      .select("id,name,domain,description,system_prompt,tools,model,temperature,max_tokens,is_active,metadata")
      .eq("user_id", owner.userId)
      .order("updated_at", { ascending: false }),
    owner.supabase
      .from("personal_whatsapp_messages")
      .select("id,contact_name,contact_number,content,classification,response_text,owner_notified,notification_reason,created_at")
      .eq("user_id", owner.userId)
      .order("created_at", { ascending: false })
      .limit(25),
    owner.supabase
      .from("personal_whatsapp_messages")
      .select("id,contact_name,contact_number,content,classification,response_text,owner_notified,notification_reason,created_at")
      .eq("user_id", owner.userId)
      .in("classification", ["urgent", "vip", "restricted"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const preferences = ownerProfile.preferences;
  const agentRows = (agents || []) as AgentRow[];
  const config = getEvolutionConfig(request);
  const connection = await getConnectionState(request);
  const activeWhatsappAgent = resolveWhatsAppAgent(preferences, agentRows);
  const recentMessages = recentResult.error ? [] : recentResult.data || [];
  const urgentMessages = urgentResult.error ? [] : urgentResult.data || [];

  return NextResponse.json({
    preferences,
    activeWhatsappAgent,
    status: {
      whatsappBotEnabled: preferences.whatsappBotEnabled,
      mode: preferences.whatsappBotEnabled ? "agent" : "manual",
      instance: config.instance,
      qrcodeUrl: `${config.appUrl}/api/whatsapp-qrcode`,
      connection,
    },
    env: {
      evolutionConfigured: Boolean(process.env.EVOLUTION_API_KEY),
      aiConfigured: Boolean(process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY),
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.WHATSAPP_OWNER_USER_ID),
      telegramOwnerConfigured: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID),
      personalOwnerNumberConfigured: Boolean(process.env.PERSONAL_WHATSAPP_OWNER_NUMBER),
      whatsappOwnerUserIdConfigured: Boolean(process.env.WHATSAPP_OWNER_USER_ID),
      usingWhatsAppOwnerProfile: owner.usesServiceOwner,
    },
    checklist: [
      { id: "bot", label: "Bot do WhatsApp ativo", ok: preferences.whatsappBotEnabled },
      { id: "connection", label: "Instancia conectada na Evolution API", ok: Boolean(connection.ok && !/close|disconnect|not/i.test(connection.state || "")) },
      { id: "agent", label: "Agente definido para responder", ok: Boolean(activeWhatsappAgent.name) },
      { id: "service", label: "Service role e dono configurados", ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.WHATSAPP_OWNER_USER_ID) },
      { id: "telegram", label: "Alertas Telegram configurados", ok: Boolean(process.env.TELEGRAM_OWNER_CHAT_ID) },
      { id: "owner", label: "Comandos do dono pelo aparelho conectado", ok: true },
    ],
    recentMessages,
    urgentMessages,
  });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = SimulationInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const owner = getWhatsAppOwnerContext({ fallbackSupabase: supabase, fallbackUser: user });
  const [ownerProfile, { data: agents }] = await Promise.all([
    loadWhatsAppOwnerPreferences(owner).catch(() => ({ preferences: DEFAULT_USER_PREFERENCES, displayName: owner.displayName })),
    owner.supabase
      .from("agents")
      .select("id,name,domain,description,system_prompt,tools,model,temperature,max_tokens,is_active")
      .eq("user_id", owner.userId),
  ]);

  const preferences = ownerProfile.preferences;
  const agentRows = (agents || []) as AgentRow[];
  const activeWhatsappAgent = resolveWhatsAppAgent(preferences, agentRows);
  const activeAgent = activeWhatsappAgent.source === "agent" ? agentRows.find((agent) => agent.id === activeWhatsappAgent.id) || null : null;
  const classification = classifyMessage(parsed.data.message, preferences, parsed.data.scenario);
  const response = await generateSimulationResponse({
    request,
    message: parsed.data.message,
    agent: activeWhatsappAgent,
    activeAgent,
    classification,
    preferences,
  });

  return NextResponse.json({
    agent: activeWhatsappAgent,
    scenario: parsed.data.scenario,
    classification,
    responsePreview: response.text,
    generatedByModel: response.generatedByModel,
    willNotifyOwner: classification.notifyOwner && Boolean(process.env.TELEGRAM_OWNER_CHAT_ID),
    willSendMessage: classification.classification !== "spam",
  });
}
