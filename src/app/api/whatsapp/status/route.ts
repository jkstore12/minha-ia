import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";
import { saveWhatsAppOwnerPreferences, getWhatsAppOwnerContext, loadWhatsAppOwnerPreferences } from "@/lib/whatsapp-owner";

export const runtime = "nodejs";

const DEFAULT_EVOLUTION_API_URL = "https://evolution-api-production-d8ba.up.railway.app";

const WhatsAppStatusInput = z.object({
  whatsappBotEnabled: z.boolean(),
});

function getEvolutionConfig(request: Request) {
  const host = request.headers.get("host") || "minha-ia-orquestrador.vercel.app";
  return {
    baseUrl: (process.env.EVOLUTION_API_URL || DEFAULT_EVOLUTION_API_URL).replace(/\/$/, ""),
    apiKey: process.env.EVOLUTION_API_KEY || "",
    instance: process.env.WHATSAPP_INSTANCE_NAME || "minha-ia",
    appUrl: process.env.NEXT_PUBLIC_APP_URL || `https://${host}`,
  };
}

async function getConnectionState(request: Request) {
  const config = getEvolutionConfig(request);
  if (!config.apiKey) {
    return { configured: false, state: "not_configured", error: "EVOLUTION_API_KEY não configurada." };
  }

  try {
    const response = await fetch(`${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instance)}`, {
      headers: {
        apikey: config.apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    const state =
      payload?.instance?.state ||
      payload?.state ||
      payload?.connectionState ||
      payload?.data?.state ||
      payload?.response?.state ||
      "unknown";

    return {
      configured: true,
      state: String(state),
      ok: response.ok,
      error: response.ok ? "" : String(payload?.message || payload?.error || `Evolution API respondeu ${response.status}.`),
    };
  } catch (error) {
    return {
      configured: true,
      state: "unknown",
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível consultar a Evolution API.",
    };
  }
}

export async function GET(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const owner = getWhatsAppOwnerContext({ fallbackSupabase: supabase, fallbackUser: user });
  const { preferences } = await loadWhatsAppOwnerPreferences(owner);
  const config = getEvolutionConfig(request);
  const connection = await getConnectionState(request);

  return NextResponse.json({
    whatsappBotEnabled: preferences.whatsappBotEnabled,
    mode: preferences.whatsappBotEnabled ? "agent" : "manual",
    instance: config.instance,
    qrcodeUrl: `${config.appUrl}/api/whatsapp-qrcode`,
    connection,
    owner: {
      usesServiceOwner: owner.usesServiceOwner,
    },
  });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = WhatsAppStatusInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const owner = getWhatsAppOwnerContext({ fallbackSupabase: supabase, fallbackUser: user });
  const saved = await saveWhatsAppOwnerPreferences(owner, {
    whatsappBotEnabled: parsed.data.whatsappBotEnabled,
  }).catch(() => null);

  if (!saved) return jsonError("Não foi possível atualizar o controle do WhatsApp.", 500);

  const config = getEvolutionConfig(request);
  const connection = await getConnectionState(request);
  const preferences = saved.preferences;

  return NextResponse.json({
    preferences,
    whatsappBotEnabled: preferences.whatsappBotEnabled,
    mode: preferences.whatsappBotEnabled ? "agent" : "manual",
    instance: config.instance,
    qrcodeUrl: `${config.appUrl}/api/whatsapp-qrcode`,
    connection,
    owner: {
      usesServiceOwner: owner.usesServiceOwner,
    },
  });
}
