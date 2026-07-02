import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";

export const runtime = "nodejs";

type PersonalMessageRow = {
  contact_name: string | null;
  contact_number: string | null;
  content: string | null;
  classification: string;
  response_text: string | null;
  created_at: string;
};

function getSupabaseConfig() {
  return {
    url: String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    ownerUserId: process.env.WHATSAPP_OWNER_USER_ID || "",
  };
}

function fortalezaDayStartIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return new Date(`${year}-${month}-${day}T03:00:00.000Z`).toISOString();
}

async function supabaseGet(path: string) {
  const config = getSupabaseConfig();
  if (!config.url || !config.serviceRoleKey || !config.ownerUserId) return null;

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Supabase respondeu ${response.status}.`);
  return payload as PersonalMessageRow[];
}

async function loadRows(type: string) {
  const config = getSupabaseConfig();
  const since = type === "daily" ? fortalezaDayStartIso() : new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const filters = [
    `user_id=eq.${encodeURIComponent(config.ownerUserId)}`,
    `created_at=gte.${encodeURIComponent(since)}`,
    "select=contact_name,contact_number,content,classification,response_text,created_at",
    "order=created_at.desc",
    "limit=50",
  ].join("&");

  return supabaseGet(`personal_whatsapp_messages?${filters}`);
}

function formatRows(rows: PersonalMessageRow[], type: string) {
  const title = type === "daily" ? "Relatorio diario do WhatsApp pessoal" : "Resumo das ultimas 2 horas";
  if (!rows.length) return `${title}\n\nNenhuma conversa registrada no periodo.`;

  const urgentCount = rows.filter((row) => ["urgent", "vip", "restricted"].includes(row.classification)).length;
  const answeredCount = rows.filter((row) => row.response_text).length;
  const items = rows.slice(0, 12).map((row, index) => {
    const contact = row.contact_name || row.contact_number || "Contato";
    const time = new Date(row.created_at).toLocaleString("pt-BR", {
      timeZone: "America/Fortaleza",
      hour: "2-digit",
      minute: "2-digit",
    });
    const content = String(row.content || "").replace(/\s+/g, " ").slice(0, 180);
    return `${index + 1}. ${contact} (${row.classification}, ${time})\n${content}`;
  });

  return [
    title,
    "",
    `Conversas: ${rows.length}`,
    `Respondidas: ${answeredCount}`,
    `Importantes: ${urgentCount}`,
    "",
    items.join("\n\n"),
  ].join("\n");
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return false;

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Não autorizado. Configure CRON_SECRET e envie Authorization: Bearer <secret>." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") === "daily" ? "daily" : "summary";
  const rows = await loadRows(type);
  if (!rows) {
    return NextResponse.json({
      ok: false,
      sent: false,
      error: "Configure NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_OWNER_USER_ID, TELEGRAM_BOT_TOKEN e TELEGRAM_OWNER_CHAT_ID.",
    });
  }

  const sent = await sendTelegram(formatRows(rows, type));
  return NextResponse.json({ ok: true, type, count: rows.length, sent });
}
