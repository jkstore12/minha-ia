import { NextResponse } from "next/server";
import { getAuthedSupabase, jsonError } from "@/lib/api/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { searchParams } = new URL(request.url);
  const level = searchParams.get("level");

  let query = supabase
    .from("agent_logs")
    .select("*, agents(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (level && level !== "all") query = query.eq("level", level);

  const { data, error } = await query;
  if (error) return jsonError("Não foi possível listar logs.", 500);
  return NextResponse.json({ logs: data || [] });
}
