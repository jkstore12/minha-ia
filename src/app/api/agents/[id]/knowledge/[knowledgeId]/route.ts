import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";

export const runtime = "nodejs";

const KnowledgePatch = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  kind: z.enum(["product", "price", "policy", "faq", "document", "service", "instruction", "other"]).optional(),
  content: z.string().trim().min(3).max(12000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  source_url: z.string().trim().url().max(500).optional().nullable().or(z.literal("")),
  priority: z.coerce.number().int().min(1).max(5).optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string; knowledgeId: string }> }) {
  const { id, knowledgeId } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = KnowledgePatch.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const patch = {
    ...parsed.data,
    tags: parsed.data.tags ? Array.from(new Set(parsed.data.tags.map((tag) => tag.trim()).filter(Boolean))) : undefined,
    source_url: parsed.data.source_url === "" ? null : parsed.data.source_url,
  };

  const { data, error } = await supabase
    .from("agent_knowledge")
    .update(patch)
    .eq("id", knowledgeId)
    .eq("agent_id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) return jsonError("Não foi possível atualizar o conhecimento.", 500);
  return NextResponse.json({ knowledge: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; knowledgeId: string }> }) {
  const { id, knowledgeId } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { error } = await supabase
    .from("agent_knowledge")
    .delete()
    .eq("id", knowledgeId)
    .eq("agent_id", id)
    .eq("user_id", user.id);

  if (error) return jsonError("Não foi possível remover o conhecimento.", 500);
  return NextResponse.json({ ok: true });
}
