import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";
import { embedText, formatEmbeddingForRpc } from "@/lib/ai/embeddings";

export const runtime = "nodejs";

const KnowledgeInput = z.object({
  title: z.string().trim().min(2).max(160),
  kind: z.enum(["product", "price", "policy", "faq", "document", "service", "instruction", "other"]).default("other"),
  content: z.string().trim().min(3).max(12000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  source_url: z.string().trim().url().max(500).optional().nullable().or(z.literal("")),
  priority: z.coerce.number().int().min(1).max(5).default(3),
  is_active: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

async function ensureAgent(supabase: Awaited<ReturnType<typeof getAuthedSupabase>>["supabase"], userId: string, agentId: string) {
  const { data, error } = await supabase
    .from("agents")
    .select("id,name")
    .eq("id", agentId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const agent = await ensureAgent(supabase, user.id, id);
  if (!agent) return jsonError("Agente não encontrado.", 404);

  const { data, error } = await supabase
    .from("agent_knowledge")
    .select("*")
    .eq("user_id", user.id)
    .eq("agent_id", id)
    .order("priority", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Base de conhecimento ainda não está configurada. Aplique a migração 0004_agent_knowledge no Supabase.", 500);
  return NextResponse.json({ agent, knowledge: data || [] });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const agent = await ensureAgent(supabase, user.id, id);
  if (!agent) return jsonError("Agente não encontrado.", 404);

  const parsed = KnowledgeInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const cleanTags = Array.from(new Set(parsed.data.tags.map((tag) => tag.trim()).filter(Boolean)));

  // Tenta gerar embedding. Se falhar, salva sem embedding (fallback
  // para o modo de busca por prioridade/recencia).
  let embedding: string | null = null;
  try {
    const text = `${parsed.data.title}\n\n${parsed.data.content}`;
    const vector = await embedText(text);
    embedding = formatEmbeddingForRpc(vector);
  } catch (err) {
    // Logar mas nao bloquear: knowledge sem embedding ainda funciona
    // via fallback (busca por prioridade).
    console.warn("[knowledge] Falha ao gerar embedding:", err instanceof Error ? err.message : err);
  }

  const { data, error } = await supabase
    .from("agent_knowledge")
    .insert({
      ...parsed.data,
      tags: cleanTags,
      source_url: parsed.data.source_url || null,
      agent_id: id,
      user_id: user.id,
      embedding,
    })
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível salvar o conhecimento. Verifique se a migração 0004_agent_knowledge foi aplicada.", 500);
  return NextResponse.json({ knowledge: data }, { status: 201 });
}
