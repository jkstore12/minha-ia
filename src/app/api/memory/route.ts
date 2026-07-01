import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";

export const runtime = "nodejs";

const MemoryInput = z.object({
  kind: z.enum(["preference", "goal", "fact", "style", "constraint"]).default("fact"),
  content: z.string().trim().min(3).max(800),
  confidence: z.coerce.number().min(0).max(1).default(0.85),
});

export async function GET() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { data, error } = await supabase
    .from("memories")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Não foi possível listar memórias.", 500);
  return NextResponse.json({ memories: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = MemoryInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { data, error } = await supabase
    .from("memories")
    .insert({ ...parsed.data, user_id: user.id })
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível criar a memória.", 500);
  return NextResponse.json({ memory: data }, { status: 201 });
}
