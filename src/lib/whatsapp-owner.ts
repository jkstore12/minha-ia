import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_USER_PREFERENCES, UserPreferencesSchema, parseUserPreferences, type UserPreferences } from "@/lib/user-preferences";

type OwnerContextInput = {
  fallbackSupabase: SupabaseClient;
  fallbackUser: {
    id: string;
    email?: string | null;
  };
};

export type WhatsAppOwnerContext = {
  supabase: SupabaseClient;
  userId: string;
  displayName: string;
  usesServiceOwner: boolean;
};

let serviceClient: SupabaseClient | null = null;

function hasServiceOwnerConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.WHATSAPP_OWNER_USER_ID,
  );
}

function getServiceClient() {
  if (!serviceClient) {
    serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}

export function getWhatsAppOwnerContext(input: OwnerContextInput): WhatsAppOwnerContext {
  if (hasServiceOwnerConfig()) {
    return {
      supabase: getServiceClient(),
      userId: process.env.WHATSAPP_OWNER_USER_ID!,
      displayName: "Dono do WhatsApp",
      usesServiceOwner: true,
    };
  }

  return {
    supabase: input.fallbackSupabase,
    userId: input.fallbackUser.id,
    displayName: input.fallbackUser.email || "Usuário",
    usesServiceOwner: false,
  };
}

export async function loadWhatsAppOwnerPreferences(context: WhatsAppOwnerContext) {
  const { data, error } = await context.supabase
    .from("user_profiles")
    .select("display_name, preferences")
    .eq("id", context.userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  return {
    displayName: data?.display_name || context.displayName,
    preferences: parseUserPreferences(data?.preferences || DEFAULT_USER_PREFERENCES),
  };
}

export async function saveWhatsAppOwnerPreferences(context: WhatsAppOwnerContext, next: Partial<UserPreferences>) {
  const current = await loadWhatsAppOwnerPreferences(context);
  const preferences = UserPreferencesSchema.parse({
    ...current.preferences,
    ...next,
  });

  const { data, error } = await context.supabase
    .from("user_profiles")
    .upsert({
      id: context.userId,
      display_name: current.displayName,
      preferences,
      updated_at: new Date().toISOString(),
    })
    .select("display_name, preferences")
    .single();

  if (error || !data) {
    throw error || new Error("Não foi possível salvar preferências do dono do WhatsApp.");
  }

  return {
    displayName: data.display_name || current.displayName,
    preferences: parseUserPreferences(data.preferences),
  };
}

