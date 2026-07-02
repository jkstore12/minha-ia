// Funcoes puras do /api/cron/reminders extraidas para serem testaveis
// sem precisar instanciar o handler Next.js.
//
// Manter sincronizado com a logica do route.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ReminderTask = {
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

const DEFAULT_ACK_SNOOZE_MINUTES = 5;

export function splitMessage(text: string) {
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

export function formatReminder(task: ReminderTask) {
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

export function getNextRecurringRunAt(task: ReminderTask, nowMs?: number) {
  const intervalMinutes = Number(task.metadata?.reminder?.intervalMinutes || 0);
  if (!task.metadata?.reminder?.recurring || !Number.isFinite(intervalMinutes) || intervalMinutes < 1) return null;

  const now = nowMs ?? Date.now();
  let next = task.next_run_at ? new Date(task.next_run_at).getTime() : now;
  const intervalMs = intervalMinutes * 60 * 1000;
  if (!Number.isFinite(next)) next = now;

  while (next <= now) next += intervalMs;
  return new Date(next).toISOString();
}

function getReminderMetadata(task: ReminderTask) {
  return task.metadata?.reminder || {};
}

export function getAckSnoozeMinutes(task: ReminderTask) {
  const minutes = Number(getReminderMetadata(task).snoozeMinutes || DEFAULT_ACK_SNOOZE_MINUTES);
  if (!Number.isFinite(minutes) || minutes < 1) return DEFAULT_ACK_SNOOZE_MINUTES;
  return Math.min(minutes, 60);
}

function getNextAckReminderRunAt(task: ReminderTask) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + getAckSnoozeMinutes(task));
  return date.toISOString();
}

export function buildAfterDeliveryPatch(task: ReminderTask, deliverySent: boolean, deliveryError?: string) {
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

export async function getTelegramChatIdForTask(supabase: SupabaseClient, task: ReminderTask) {
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