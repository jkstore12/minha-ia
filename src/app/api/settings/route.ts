import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";
import { DEFAULT_USER_PREFERENCES, UserPreferencesSchema, parseUserPreferences } from "@/lib/user-preferences";

export const runtime = "nodejs";

const SettingsInput = z.object({
  displayName: z.string().trim().max(120).optional(),
  preferences: UserPreferencesSchema.partial().optional(),
});

export async function GET() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { data, error } = await supabase
    .from("user_profiles")
    .select("display_name, preferences")
    .eq("id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return jsonError("Não foi possível carregar suas configurações.", 500);
  }

  return NextResponse.json({
    displayName: data?.display_name || user.email || "Usuário",
    preferences: parseUserPreferences(data?.preferences || DEFAULT_USER_PREFERENCES),
  });
}

export async function PATCH(request: Request) {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const parsed = SettingsInput.safeParse(await parseJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");
  }

  const { data: existing } = await supabase
    .from("user_profiles")
    .select("preferences")
    .eq("id", user.id)
    .single();

  const currentPreferences = parseUserPreferences(existing?.preferences || DEFAULT_USER_PREFERENCES);
  const nextPreferences = UserPreferencesSchema.parse({
    ...currentPreferences,
    ...(parsed.data.preferences || {}),
  });

  const { data, error } = await supabase
    .from("user_profiles")
    .upsert({
      id: user.id,
      display_name: parsed.data.displayName || user.email || "Usuário",
      preferences: nextPreferences,
      updated_at: new Date().toISOString(),
    })
    .select("display_name, preferences")
    .single();

  if (error || !data) {
    return jsonError("Não foi possível salvar suas configurações.", 500);
  }

  return NextResponse.json({
    displayName: data.display_name,
    preferences: parseUserPreferences(data.preferences),
  });
}
