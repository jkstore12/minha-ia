import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";

export const runtime = "nodejs";

const ConnectorPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  provider: z.enum(["openai", "openrouter", "anthropic", "google", "openai_compatible", "custom"]).optional(),
  base_url: z.string().trim().url().optional(),
  auth_type: z.enum(["bearer_token", "api_key", "basic_auth", "none"]).optional(),
  credential_hint: z.string().trim().max(120).optional().nullable(),
  headers: z.record(z.string(), z.unknown()).optional(),
  rate_limit_per_minute: z.coerce.number().int().min(1).max(10000).optional(),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = ConnectorPatch.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { data, error } = await supabase
    .from("api_connectors")
    .update(parsed.data)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível atualizar o conector.", 500);
  return NextResponse.json({ connector: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { error } = await supabase.from("api_connectors").delete().eq("id", id).eq("user_id", user.id);
  if (error) return jsonError("Não foi possível remover o conector.", 500);
  return NextResponse.json({ ok: true });
}
