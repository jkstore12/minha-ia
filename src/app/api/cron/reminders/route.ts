import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  buildAfterDeliveryPatch,
  formatReminder,
  getTelegramChatIdForTask,
  splitMessage,
  type ReminderTask,
} from "./helpers";

export const runtime = "nodejs";

const DEFAULT_EVOLUTION_API_URL = "https://evolution-api-production-d8ba.up.railway.app";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function getEvolutionConfig() {
  return {
    baseUrl: (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_API_URL).replace(/\/$/, ""),
    apiKey: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.WHATSAPP_INSTANCE_NAME || "minha-ia",
    ownerNumber: process.env.PERSONAL_WHATSAPP_OWNER_NUMBER || "",
  };
}

async function sendTelegram(supabase: SupabaseClient, task: ReminderTask, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = await getTelegramChatIdForTask(supabase, task);
  if (!token || !chatId) return { ok: false, skipped: true, channel: "telegram", error: "Telegram não configurado." };

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    skipped: false,
    channel: "telegram",
    error: response.ok ? "" : String(payload?.description || payload?.error || `Telegram respondeu ${response.status}.`),
  };
}

async function sendWhatsApp(task: ReminderTask, text: string) {
  const ownerUserId = process.env.WHATSAPP_OWNER_USER_ID;
  if (ownerUserId && task.user_id !== ownerUserId) {
    return { ok: false, skipped: true, channel: "whatsapp", error: "WhatsApp restrito ao dono principal." };
  }

  const config = getEvolutionConfig();
  if (!config.apiKey || !config.ownerNumber) {
    return { ok: false, skipped: true, channel: "whatsapp", error: "WhatsApp não configurado." };
  }

  for (const chunk of splitMessage(text)) {
    const response = await fetch(`${config.baseUrl}/message/sendText/${encodeURIComponent(config.instance)}`, {
      method: "POST",
      headers: {
        apikey: config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number: config.ownerNumber,
        text: chunk,
        delay: 400,
        linkPreview: false,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        channel: "whatsapp",
        error: String(payload?.message || payload?.error || `Evolution API respondeu ${response.status}.`),
      };
    }
  }

  return { ok: true, skipped: false, channel: "whatsapp", error: "" };
}

async function deliverReminder(supabase: SupabaseClient, task: ReminderTask) {
  const channels = task.notification_channels?.length ? task.notification_channels : ["telegram", "whatsapp"];
  const text = formatReminder(task);
  const results = [];

  if (channels.includes("telegram")) results.push(await sendTelegram(supabase, task, text));
  if (channels.includes("whatsapp")) results.push(await sendWhatsApp(task, text));

  const sent = results.some((result) => result.ok);
  const errors = results.filter((result) => !result.ok && !result.skipped).map((result) => `${result.channel}: ${result.error}`);
  const skipped = results.filter((result) => result.skipped).map((result) => `${result.channel}: ${result.error}`);

  return {
    sent,
    results,
    error: errors.concat(sent ? [] : skipped).join(" | "),
  };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Não autorizado. Configure CRON_SECRET e envie Authorization: Bearer <secret>." },
      { status: 401 },
    );
  }

  if (process.env.REMINDERS_CRON_ENABLED === "false") {
    return NextResponse.json({ ok: true, disabled: true, count: 0, processed: [] });
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("scheduled_tasks")
    .select("id,user_id,title,prompt,next_run_at,notification_channels,metadata")
    .eq("is_active", true)
    .eq("cron_expression", "reminder")
    .lte("next_run_at", nowIso)
    .is("notified_at", null)
    .order("next_run_at", { ascending: true })
    .limit(10);

  if (error) {
    return NextResponse.json({ ok: false, error: "Não foi possível buscar lembretes vencidos." }, { status: 500 });
  }

  const tasks = (data || []) as ReminderTask[];
  const processed = [];

  for (const task of tasks) {
    const { data: lockedRows, error: lockError } = await supabase
      .from("scheduled_tasks")
      .update({ notification_status: "running", notification_error: null })
      .eq("id", task.id)
      .is("notified_at", null)
      .select("id");

    if (lockError || !lockedRows?.length) {
      processed.push({ id: task.id, sent: false, skipped: true, error: lockError?.message || "Já estava em processamento." });
      continue;
    }

    const delivery = await deliverReminder(supabase, task);
    const patch = buildAfterDeliveryPatch(task, delivery.sent, delivery.error);
    await supabase
      .from("scheduled_tasks")
      .update(patch)
      .eq("id", task.id)
      .eq("user_id", task.user_id);

    await supabase.from("task_executions").insert({
      user_id: task.user_id,
      scheduled_task_id: task.id,
      status: delivery.sent ? "success" : "error",
      output: delivery.sent ? "Lembrete enviado." : null,
      error: delivery.sent ? null : delivery.error || "Falha ao enviar lembrete.",
      finished_at: new Date().toISOString(),
    });

    processed.push({
      id: task.id,
      title: task.title,
      sent: delivery.sent,
      nextRunAt: patch.next_run_at || null,
      awaitingAck: Boolean(patch.metadata?.reminder?.awaitingAck),
      results: delivery.results,
      error: delivery.error,
    });
  }

  return NextResponse.json({ ok: true, checkedAt: nowIso, count: tasks.length, processed });
}