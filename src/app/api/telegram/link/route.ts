import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthedSupabase, jsonError } from "@/lib/api/server";
import { DEFAULT_USER_PREFERENCES, UserPreferencesSchema, parseUserPreferences } from "@/lib/user-preferences";

export const runtime = "nodejs";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

function createLinkCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

function publicTelegramStatus(preferences: ReturnType<typeof parseUserPreferences>) {
  const integration = preferences.telegramIntegration;
  const codeIsValid = Boolean(
    integration.linkCode &&
      integration.linkCodeExpiresAt &&
      new Date(integration.linkCodeExpiresAt).getTime() > Date.now(),
  );

  return {
    linked: Boolean(integration.chatId),
    chatId: integration.chatId ? String(integration.chatId) : "",
    userName: integration.userName || "",
    linkedAt: integration.linkedAt || "",
    linkCode: codeIsValid ? integration.linkCode : "",
    linkCodeExpiresAt: codeIsValid ? integration.linkCodeExpiresAt : "",
  };
}

async function loadCurrentProfile() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return { supabase, user: null, preferences: null };

  const { data, error } = await supabase
    .from("user_profiles")
    .select("display_name, preferences")
    .eq("id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error("Não foi possível carregar o perfil.");
  }

  return {
    supabase,
    user,
    displayName: data?.display_name || user.email || "Usuário",
    preferences: parseUserPreferences(data?.preferences || DEFAULT_USER_PREFERENCES),
  };
}

export async function GET() {
  try {
    const { user, preferences } = await loadCurrentProfile();
    if (!user || !preferences) return jsonError("Sessão expirada.", 401);
    return NextResponse.json({ telegram: publicTelegramStatus(preferences) });
  } catch {
    return jsonError("Não foi possível carregar o vínculo do Telegram.", 500);
  }
}

export async function POST() {
  try {
    const { supabase, user, displayName, preferences } = await loadCurrentProfile();
    if (!user || !preferences) return jsonError("Sessão expirada.", 401);

    const nextPreferences = UserPreferencesSchema.parse({
      ...preferences,
      telegramIntegration: {
        ...preferences.telegramIntegration,
        linkCode: createLinkCode(),
        linkCodeExpiresAt: new Date(Date.now() + LINK_CODE_TTL_MS).toISOString(),
      },
    });

    const { data, error } = await supabase
      .from("user_profiles")
      .upsert({
        id: user.id,
        display_name: displayName,
        preferences: nextPreferences,
        updated_at: new Date().toISOString(),
      })
      .select("preferences")
      .single();

    if (error || !data) return jsonError("Não foi possível gerar o código do Telegram.", 500);
    return NextResponse.json({ telegram: publicTelegramStatus(parseUserPreferences(data.preferences)) });
  } catch {
    return jsonError("Não foi possível gerar o código do Telegram.", 500);
  }
}

export async function DELETE() {
  try {
    const { supabase, user, displayName, preferences } = await loadCurrentProfile();
    if (!user || !preferences) return jsonError("Sessão expirada.", 401);

    const nextPreferences = UserPreferencesSchema.parse({
      ...preferences,
      telegramIntegration: {
        chatId: "",
        userName: "",
        linkedAt: "",
        linkCode: "",
        linkCodeExpiresAt: "",
      },
    });

    const { data, error } = await supabase
      .from("user_profiles")
      .upsert({
        id: user.id,
        display_name: displayName,
        preferences: nextPreferences,
        updated_at: new Date().toISOString(),
      })
      .select("preferences")
      .single();

    if (error || !data) return jsonError("Não foi possível remover o vínculo do Telegram.", 500);
    return NextResponse.json({ telegram: publicTelegramStatus(parseUserPreferences(data.preferences)) });
  } catch {
    return jsonError("Não foi possível remover o vínculo do Telegram.", 500);
  }
}
