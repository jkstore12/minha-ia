import { NextResponse } from "next/server";
import { getAuthedSupabase, jsonError } from "@/lib/api/server";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { error } = await supabase.from("memories").delete().eq("id", id).eq("user_id", user.id);
  if (error) return jsonError("Não foi possível remover a memória.", 500);
  return NextResponse.json({ ok: true });
}
