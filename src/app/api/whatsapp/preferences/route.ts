import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";
import { UserPreferencesSchema } from "@/lib/user-preferences";
import { getWhatsAppOwnerContext, saveWhatsAppOwnerPreferences } from "@/lib/whatsapp-owner";

export const runtime = "nodejs";

const WhatsAppPreferencesInput = z.object({
  preferences: UserPreferencesSchema.partial(),
});

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = WhatsAppPreferencesInput.safeParse(await parseJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");
  }

  const owner = getWhatsAppOwnerContext({ fallbackSupabase: supabase, fallbackUser: user });
  const saved = await saveWhatsAppOwnerPreferences(owner, parsed.data.preferences).catch(() => null);
  if (!saved) {
    return jsonError("Não foi possível salvar as preferências reais do WhatsApp.", 500);
  }

  return NextResponse.json({
    displayName: saved.displayName,
    preferences: saved.preferences,
    owner: {
      usesServiceOwner: owner.usesServiceOwner,
    },
  });
}

