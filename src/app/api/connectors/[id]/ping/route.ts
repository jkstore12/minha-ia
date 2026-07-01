import { NextResponse } from "next/server";
import { getAuthedSupabase, jsonError } from "@/lib/api/server";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { data: connector, error } = await supabase
    .from("api_connectors")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !connector) return jsonError("Conector não encontrado.", 404);

  const url = String(connector.base_url).replace(/\/$/, "");
  const credentialName = String(connector.credential_hint || "").trim();
  const apiKey = credentialName ? process.env[credentialName] : undefined;
  let ok = false;
  let message = "Conector salvo. Não foi possível validar automaticamente.";

  if (connector.auth_type !== "none" && credentialName && !apiKey) {
    await supabase
      .from("api_connectors")
      .update({ last_ping_at: new Date().toISOString(), last_ping_ok: false })
      .eq("id", id)
      .eq("user_id", user.id);

    return NextResponse.json({
      ok: false,
      message: `Variavel ${credentialName} não configurada no servidor.`,
    });
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && connector.auth_type === "bearer_token") headers.Authorization = `Bearer ${apiKey}`;
  if (apiKey && connector.auth_type === "api_key") headers["x-api-key"] = apiKey;

  try {
    const response = await fetch(`${url}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(Math.min(Number(connector.timeout_ms || 30000), 15000)),
    });
    ok = response.ok;
    if (ok) {
      message = "Conector validado com sucesso.";
    } else if (response.status === 401 || response.status === 403) {
      message = "Endpoint respondeu, mas a chave foi recusada.";
    } else {
      message = `Endpoint retornou ${response.status}.`;
    }
  } catch {
    ok = false;
    message = "Falha ao conectar no endpoint /models.";
  }

  await supabase
    .from("api_connectors")
    .update({ last_ping_at: new Date().toISOString(), last_ping_ok: ok })
    .eq("id", id)
    .eq("user_id", user.id);

  return NextResponse.json({ ok, message });
}
