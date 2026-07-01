import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";
import { parseUserPreferences } from "@/lib/user-preferences";

export const runtime = "nodejs";

const TaskInput = z.object({
  agent_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(2).max(120),
  prompt: z.string().trim().min(3).max(8000),
  recurrence: z.enum(["hourly", "daily", "weekly", "monthly", "custom"]).default("daily"),
  cron_expression: z.string().trim().max(120).optional().nullable(),
  next_run_at: z.string().datetime().optional().nullable(),
  notification_channels: z.array(z.enum(["telegram", "whatsapp"])).max(2).default(["telegram", "whatsapp"]),
  is_active: z.boolean().default(true),
});

export async function GET() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { data, error } = await supabase
    .from("scheduled_tasks")
    .select("*, agents(name)")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Não foi possível listar agendamentos.", 500);
  return NextResponse.json({ tasks: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = TaskInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("preferences")
    .eq("id", user.id)
    .single();

  const preferences = parseUserPreferences(profile?.preferences);
  const telegramChatId = preferences.telegramIntegration.chatId;
  const metadata = parsed.data.cron_expression === "reminder"
    ? {
        reminder: {
          source: "app",
          ackRequired: true,
          awaitingAck: false,
          snoozeMinutes: 5,
          telegramChatId: telegramChatId || null,
          linkedUserId: user.id,
        },
      }
    : undefined;

  const { data, error } = await supabase
    .from("scheduled_tasks")
    .insert({ ...parsed.data, user_id: user.id, ...(metadata ? { metadata } : {}) })
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível criar o agendamento.", 500);
  return NextResponse.json({ task: data }, { status: 201 });
}
