import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";

export const runtime = "nodejs";

const ConnectorInput = z.object({
  name: z.string().trim().min(2).max(80),
  provider: z.enum(["openai", "openrouter", "anthropic", "google", "openai_compatible", "custom"]).default("openai_compatible"),
  base_url: z.string().trim().url(),
  auth_type: z.enum(["bearer_token", "api_key", "basic_auth", "none"]).default("bearer_token"),
  credential_hint: z.string().trim().max(120).optional().nullable(),
  headers: z.record(z.string(), z.unknown()).default({}),
  rate_limit_per_minute: z.coerce.number().int().min(1).max(10000).default(60),
  timeout_ms: z.coerce.number().int().min(1000).max(120000).default(30000),
  is_active: z.boolean().default(true),
});

export async function GET() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { data, error } = await supabase
    .from("api_connectors")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Não foi possível listar conectores.", 500);
  return NextResponse.json({ connectors: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = ConnectorInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { data, error } = await supabase
    .from("api_connectors")
    .insert({ ...parsed.data, user_id: user.id })
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível criar o conector.", 500);
  return NextResponse.json({ connector: data }, { status: 201 });
}
