import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";

export const runtime = "nodejs";

const AgentPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(400).optional().nullable(),
  domain: z.enum(["orchestrator", "research", "analysis", "content", "automation", "support", "fallback", "custom"]).optional(),
  model: z.string().trim().max(160).optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  max_tokens: z.coerce.number().int().min(256).max(128000).optional(),
  system_prompt: z.string().trim().max(8000).optional().nullable(),
  tools: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  connector_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
  is_orchestrator: z.boolean().optional(),
  is_fallback: z.boolean().optional(),
  status: z.enum(["idle", "running", "error", "disabled"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = AgentPatch.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { data, error } = await supabase
    .from("agents")
    .update(parsed.data)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível atualizar o agente.", 500);
  return NextResponse.json({ agent: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { error } = await supabase.from("agents").delete().eq("id", id).eq("user_id", user.id);
  if (error) return jsonError("Não foi possível remover o agente.", 500);
  return NextResponse.json({ ok: true });
}
