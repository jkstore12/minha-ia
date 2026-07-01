import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";

export const runtime = "nodejs";

const AgentInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).optional().nullable(),
  domain: z.enum(["orchestrator", "research", "analysis", "content", "automation", "support", "fallback", "custom"]).default("custom"),
  model: z.string().trim().max(160).optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  max_tokens: z.coerce.number().int().min(256).max(128000).default(4096),
  system_prompt: z.string().trim().max(8000).optional().nullable(),
  tools: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  connector_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
  is_orchestrator: z.boolean().default(false),
  is_fallback: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function GET() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Não foi possível listar agentes.", 500);
  return NextResponse.json({ agents: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = AgentInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { data, error } = await supabase
    .from("agents")
    .insert({ ...parsed.data, user_id: user.id })
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível criar o agente.", 500);
  return NextResponse.json({ agent: data }, { status: 201 });
}
