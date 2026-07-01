import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type ReminderTask = {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  next_run_at: string | null;
  notification_channels: string[] | null;
  metadata: {
    reminder?: {
      ackRequired?: boolean;
      awaitingAck?: boolean;
      snoozeMinutes?: number | null;
      firstNotifiedAt?: string | null;
      lastNotifiedAt?: string | null;
      telegramChatId?: string | null;
      recurring?: boolean;
      intervalMinutes?: number | null;
      intervalText?: string | null;
    };
  } | null;
};

const DEFAULT_EVOLUTION_API_URL = "https://evolution-api-production-d8ba.up.railway.app";
const DEFAULT_ACK_SNOOZE_MINUTES = 5;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

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

function splitMessage(text: string) {
  const limit = 3500;
  const chunks: string[] = [];
  let remaining = String(text || "").trim();
  while (remaining.length > limit) {
    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }
  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : ["Lembrete sem conteúdo."];
}

function formatReminder(task: ReminderTask) {
  const when = task.next_run_at
    ? new Date(task.next_run_at).toLocaleString("pt-BR", {
        timeZone: "America/Fortaleza",
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "agora";

  return [
    "🔔 Lembrete",
    task.metadata?.reminder?.awaitingAck ? "Ainda aguardando seu ok para encerrar." : null,
    "",
    task.title,
    "",
    task.prompt && task.prompt !== task.title ? task.prompt : null,
    "",
    `Horário: ${when}`,
    "",
    "Responda ok quando concluir. Enquanto não confirmar, vou lembrar de novo em 5 minutos.",
  ].filter(Boolean).join("\n");
}

async function getTelegramChatIdForTask(supabase: SupabaseClient, task: ReminderTask) {
  const ownerUserId = process.env.WHATSAPP_OWNER_USER_ID;
  const fallbackOwnerChatId = ownerUserId && task.user_id === ownerUserId ? process.env.TELEGRAM_OWNER_CHAT_ID : "";
  if (task.metadata?.reminder?.telegramChatId) return task.metadata.reminder.telegramChatId;

  const { data } = await supabase
    .from("user_profiles")
    .select("preferences")
    .eq("id", task.user_id)
    .single();
  const preferences = (data?.preferences || {}) as { telegramIntegration?: { chatId?: string } };
  return preferences.telegramIntegration?.chatId || fallbackOwnerChatId || "";
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

function getNextRecurringRunAt(task: ReminderTask) {
  const intervalMinutes = Number(task.metadata?.reminder?.intervalMinutes || 0);
  if (!task.metadata?.reminder?.recurring || !Number.isFinite(intervalMinutes) || intervalMinutes < 1) return null;

  const now = Date.now();
  let next = task.next_run_at ? new Date(task.next_run_at).getTime() : now;
  const intervalMs = intervalMinutes * 60 * 1000;
  if (!Number.isFinite(next)) next = now;

  while (next <= now) next += intervalMs;
  return new Date(next).toISOString();
}

function getReminderMetadata(task: ReminderTask) {
  return task.metadata?.reminder || {};
}

function getAckSnoozeMinutes(task: ReminderTask) {
  const minutes = Number(getReminderMetadata(task).snoozeMinutes || DEFAULT_ACK_SNOOZE_MINUTES);
  if (!Number.isFinite(minutes) || minutes < 1) return DEFAULT_ACK_SNOOZE_MINUTES;
  return Math.min(minutes, 60);
}

function getNextAckReminderRunAt(task: ReminderTask) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + getAckSnoozeMinutes(task));
  return date.toISOString();
}

function buildAfterDeliveryPatch(task: ReminderTask, deliverySent: boolean, deliveryError?: string) {
  if (!deliverySent) {
    return {
      last_run_at: new Date().toISOString(),
      last_status: "error",
      notification_status: "error",
      notification_error: deliveryError || "Falha ao enviar lembrete.",
    };
  }

  const nowIso = new Date().toISOString();
  const reminder = getReminderMetadata(task);
  const ackRequired = reminder.ackRequired !== false;

  if (ackRequired) {
    return {
      is_active: true,
      last_run_at: nowIso,
      last_status: "success",
      next_run_at: getNextAckReminderRunAt(task),
      notified_at: null,
      notification_status: "pending",
      notification_error: null,
      metadata: {
        ...(task.metadata || {}),
        reminder: {
          ...reminder,
          ackRequired: true,
          awaitingAck: true,
          snoozeMinutes: getAckSnoozeMinutes(task),
          firstNotifiedAt: reminder.firstNotifiedAt || nowIso,
          lastNotifiedAt: nowIso,
        },
      },
    };
  }

  const nextRecurringRunAt = getNextRecurringRunAt(task);
  return {
    is_active: nextRecurringRunAt ? true : false,
    last_run_at: nowIso,
    last_status: "success",
    next_run_at: nextRecurringRunAt || task.next_run_at,
    notified_at: nextRecurringRunAt ? null : nowIso,
    notification_status: nextRecurringRunAt ? "pending" : "sent",
    notification_error: null,
  };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });
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
