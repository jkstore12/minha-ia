import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";

export const runtime = "nodejs";

const TaskPatch = z.object({
  agent_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(2).max(120).optional(),
  prompt: z.string().trim().min(3).max(8000).optional(),
  recurrence: z.enum(["hourly", "daily", "weekly", "monthly", "custom"]).optional(),
  cron_expression: z.string().trim().max(120).optional().nullable(),
  next_run_at: z.string().datetime().optional().nullable(),
  notification_channels: z.array(z.enum(["telegram", "whatsapp"])).max(2).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = TaskPatch.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { data, error } = await supabase
    .from("scheduled_tasks")
    .update(parsed.data)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível atualizar o agendamento.", 500);
  return NextResponse.json({ task: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { error } = await supabase.from("scheduled_tasks").delete().eq("id", id).eq("user_id", user.id);
  if (error) return jsonError("Não foi possível remover o agendamento.", 500);
  return NextResponse.json({ ok: true });
}
