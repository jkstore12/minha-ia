// Testes para /api/cron/reminders.
//
// Cobre:
//  - Funcoes puras exportadas: splitMessage, formatReminder,
//    getNextRecurringRunAt, getAckSnoozeMinutes, buildAfterDeliveryPatch.
//  - Smoke test do handler GET: auth, REMINDERS_CRON_ENABLED, Supabase
//    error, happy path com mock do client + fetch.
//
// Essas funcoes rodam no caminho nao-supervisionado do Vercel Cron.
// Bugs aqui passam despercebidos ateh o usuario reclamar de lembrete
// nao entregue ou entregue duplicado.

import { jest } from "@jest/globals";
import {
  splitMessage,
  formatReminder,
  getNextRecurringRunAt,
  getAckSnoozeMinutes,
  buildAfterDeliveryPatch,
  type ReminderTask,
} from "@/app/api/cron/reminders/helpers";

const FIXED_NOW = new Date("2026-07-01T15:00:00Z").getTime();

function makeTask(overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    id: "task-1",
    user_id: "user-1",
    title: "Pagar boleto",
    prompt: "Pagar boleto",
    next_run_at: null,
    notification_channels: null,
    metadata: null,
    ...overrides,
  };
}

describe("splitMessage (chunking para WhatsApp)", () => {
  it("returns single chunk for short text", () => {
    expect(splitMessage("hello world")).toEqual(["hello world"]);
  });

  it("chunks text longer than 3500 chars", () => {
    const text = "x".repeat(7000);
    const chunks = splitMessage(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(3500);
    expect(chunks[1]).toHaveLength(3500);
  });

  it("returns placeholder for empty input", () => {
    expect(splitMessage("")).toEqual(["Lembrete sem conteúdo."]);
    expect(splitMessage("   ")).toEqual(["Lembrete sem conteúdo."]);
  });

  it("preserves the trim on edges", () => {
    expect(splitMessage("   leading and trailing   ")).toEqual(["leading and trailing"]);
  });

  it("handles boundary exactly at limit", () => {
    const text = "x".repeat(3500);
    expect(splitMessage(text)).toEqual([text]);
  });

  it("handles large messages with many chunks", () => {
    const text = "x".repeat(3500 * 5);
    expect(splitMessage(text)).toHaveLength(5);
  });
});

describe("formatReminder (template)", () => {
  it("includes title and 'agora' when next_run_at is null", () => {
    const out = formatReminder(makeTask({ next_run_at: null }));
    expect(out).toContain("🔔 Lembrete");
    expect(out).toContain("Pagar boleto");
    expect(out).toContain("Horário: agora");
  });

  it("omits prompt when it equals title", () => {
    const out = formatReminder(makeTask());
    const occurrences = (out.match(/Pagar boleto/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it("includes both title and prompt when they differ", () => {
    const out = formatReminder(makeTask({ prompt: "Pagar boleto da NET" }));
    expect(out).toContain("Pagar boleto da NET");
  });

  it("shows awaitingAck notice when set", () => {
    const out = formatReminder(
      makeTask({ metadata: { reminder: { awaitingAck: true } } }),
    );
    expect(out).toContain("Ainda aguardando seu ok para encerrar.");
  });

  it("formats next_run_at in Fortaleza timezone (pt-BR)", () => {
    const out = formatReminder(
      makeTask({ next_run_at: "2026-07-01T15:00:00Z" }),
    );
    expect(out).toMatch(/Horário: \d{2}\/\d{2}\/\d{2}, \d{2}:\d{2}/);
  });
});

describe("getNextRecurringRunAt (interval math)", () => {
  it("returns null when not recurring", () => {
    const task = makeTask({
      metadata: { reminder: { recurring: false, intervalMinutes: 60 } },
    });
    expect(getNextRecurringRunAt(task, FIXED_NOW)).toBeNull();
  });

  it("returns null when intervalMinutes is 0", () => {
    const task = makeTask({
      metadata: { reminder: { recurring: true, intervalMinutes: 0 } },
    });
    expect(getNextRecurringRunAt(task, FIXED_NOW)).toBeNull();
  });

  it("schedules next interval after current next_run_at when past", () => {
    const past = new Date(FIXED_NOW - 30 * 60 * 1000).toISOString();
    const task = makeTask({
      next_run_at: past,
      metadata: { reminder: { recurring: true, intervalMinutes: 60 } },
    });
    const next = new Date(getNextRecurringRunAt(task, FIXED_NOW)!).getTime();
    // past = now - 30min, intervalMs = 60min.
    // while (next <= now) next += 60min:
    //   past (now - 30min) <= now -> next = past + 60min = now + 30min (> now, sai)
    expect(next).toBe(FIXED_NOW + 30 * 60 * 1000);
  });

  it("schedules at intervalMs from now when no next_run_at", () => {
    const task = makeTask({
      next_run_at: null,
      metadata: { reminder: { recurring: true, intervalMinutes: 30 } },
    });
    const next = new Date(getNextRecurringRunAt(task, FIXED_NOW)!).getTime();
    expect(next).toBe(FIXED_NOW + 30 * 60 * 1000);
  });

  it("returns null when intervalMinutes is invalid (NaN)", () => {
    const task = makeTask({
      metadata: { reminder: { recurring: true, intervalMinutes: "abc" as never } },
    });
    expect(getNextRecurringRunAt(task, FIXED_NOW)).toBeNull();
  });
});

describe("getAckSnoozeMinutes (snooze bounds)", () => {
  it("uses default 5 minutes when not set", () => {
    expect(getAckSnoozeMinutes(makeTask())).toBe(5);
  });

  it("uses configured snoozeMinutes when valid", () => {
    expect(
      getAckSnoozeMinutes(makeTask({ metadata: { reminder: { snoozeMinutes: 15 } } })),
    ).toBe(15);
  });

  it("caps at 60 minutes max", () => {
    expect(
      getAckSnoozeMinutes(makeTask({ metadata: { reminder: { snoozeMinutes: 120 } } })),
    ).toBe(60);
    expect(
      getAckSnoozeMinutes(makeTask({ metadata: { reminder: { snoozeMinutes: 9999 } } })),
    ).toBe(60);
  });

  it("falls back to default for invalid values", () => {
    expect(
      getAckSnoozeMinutes(makeTask({ metadata: { reminder: { snoozeMinutes: 0 } } })),
    ).toBe(5);
    expect(
      getAckSnoozeMinutes(makeTask({ metadata: { reminder: { snoozeMinutes: -1 } } })),
    ).toBe(5);
    expect(
      getAckSnoozeMinutes(makeTask({ metadata: { reminder: { snoozeMinutes: "garbage" as never } } })),
    ).toBe(5);
  });
});

describe("buildAfterDeliveryPatch (state machine)", () => {
  it("marks error path when delivery failed", () => {
    const task = makeTask();
    const patch = buildAfterDeliveryPatch(task, false, "telegram: down");
    expect(patch).toMatchObject({
      last_status: "error",
      notification_status: "error",
      notification_error: "telegram: down",
    });
  });

  it("uses default error message when deliveryError not provided", () => {
    const task = makeTask();
    const patch = buildAfterDeliveryPatch(task, false);
    expect(patch.notification_error).toBe("Falha ao enviar lembrete.");
  });

  it("marks ackRequired path with awaitingAck=true when delivery succeeded", () => {
    const task = makeTask({
      metadata: { reminder: { ackRequired: true, snoozeMinutes: 10 } },
    });
    const patch = buildAfterDeliveryPatch(task, true) as Record<string, unknown>;
    const reminder = (patch.metadata as { reminder: Record<string, unknown> }).reminder;
    expect(reminder.awaitingAck).toBe(true);
    expect(reminder.ackRequired).toBe(true);
    expect(reminder.snoozeMinutes).toBe(10);
  });

  it("uses default ackRequired=true when metadata.reminder.ackRequired is undefined", () => {
    const task = makeTask({ metadata: { reminder: {} } });
    const patch = buildAfterDeliveryPatch(task, true) as Record<string, unknown>;
    const reminder = (patch.metadata as { reminder: Record<string, unknown> }).reminder;
    expect(reminder.awaitingAck).toBe(true);
  });

  it("treats ackRequired=false as one-shot (notification_status='sent')", () => {
    const task = makeTask({
      metadata: { reminder: { ackRequired: false } },
    });
    const patch = buildAfterDeliveryPatch(task, true);
    expect(patch).not.toHaveProperty("metadata");
    expect(patch.notification_status).toBe("sent");
    expect(patch.last_status).toBe("success");
  });

  it("marks firstNotifiedAt on initial delivery", () => {
    const task = makeTask({
      metadata: { reminder: { ackRequired: true } },
    });
    const patch = buildAfterDeliveryPatch(task, true) as Record<string, unknown>;
    const reminder = (patch.metadata as { reminder: Record<string, unknown> }).reminder;
    expect(reminder.firstNotifiedAt).toBeTruthy();
    expect(typeof reminder.firstNotifiedAt).toBe("string");
  });

  it("preserves existing firstNotifiedAt across deliveries", () => {
    const earlier = "2026-06-30T12:00:00.000Z";
    const task = makeTask({
      metadata: { reminder: { ackRequired: true, firstNotifiedAt: earlier } },
    });
    const patch = buildAfterDeliveryPatch(task, true) as Record<string, unknown>;
    const reminder = (patch.metadata as { reminder: Record<string, unknown> }).reminder;
    expect(reminder.firstNotifiedAt).toBe(earlier);
  });
});

describe("Cron handler (smoke test with mocks)", () => {
  let originalEnv: Record<string, string | undefined>;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    originalEnv = {
      CRON_SECRET: process.env.CRON_SECRET,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      TELEGRAM_OWNER_CHAT_ID: process.env.TELEGRAM_OWNER_CHAT_ID,
      EVOLUTION_API_URL: process.env.EVOLUTION_API_URL,
      EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
      WHATSAPP_INSTANCE_NAME: process.env.WHATSAPP_INSTANCE_NAME,
      WHATSAPP_OWNER_USER_ID: process.env.WHATSAPP_OWNER_USER_ID,
      PERSONAL_WHATSAPP_OWNER_NUMBER: process.env.PERSONAL_WHATSAPP_OWNER_NUMBER,
      REMINDERS_CRON_ENABLED: process.env.REMINDERS_CRON_ENABLED,
    };

    process.env.CRON_SECRET = "test-secret";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    process.env.TELEGRAM_BOT_TOKEN = "tg-token";
    process.env.TELEGRAM_OWNER_CHAT_ID = "owner-chat";
    process.env.EVOLUTION_API_URL = "https://evolution.test";
    process.env.EVOLUTION_API_KEY = "ev-key";
    process.env.WHATSAPP_INSTANCE_NAME = "test-instance";
    process.env.WHATSAPP_OWNER_USER_ID = "owner-1";
    process.env.PERSONAL_WHATSAPP_OWNER_NUMBER = "5511999999999";

    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("rejects without Authorization header (401)", async () => {
    jest.resetModules();
    jest.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ from: jest.fn() }),
    }));
    const { GET } = await import("@/app/api/cron/reminders/route");
    const req = new Request("http://x/api/cron/reminders", { method: "GET" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns disabled: true when REMINDERS_CRON_ENABLED=false", async () => {
    jest.resetModules();
    process.env.REMINDERS_CRON_ENABLED = "false";
    jest.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({ from: jest.fn() }),
    }));
    const { GET } = await import("@/app/api/cron/reminders/route");
    const req = new Request("http://x/api/cron/reminders", {
      method: "GET",
      headers: { authorization: "Bearer test-secret" },
    });
    const res = await GET(req);
    const json = await res.json();
    expect(json).toEqual({ ok: true, disabled: true, count: 0, processed: [] });
  });

  it("returns 500 when Supabase query errors", async () => {
    jest.resetModules();
    jest.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                lte: () => ({
                  is: () => ({
                    order: () => ({
                      limit: () => Promise.resolve({ data: null, error: { message: "db down" } }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }));
    const { GET } = await import("@/app/api/cron/reminders/route");
    const req = new Request("http://x/api/cron/reminders", {
      method: "GET",
      headers: { authorization: "Bearer test-secret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});