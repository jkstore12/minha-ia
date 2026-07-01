import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

type DynamicDatabase = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          display_name: string | null;
          preferences: Record<string, unknown>;
          role: "admin" | "user";
          approval_status: "pending" | "approved" | "blocked";
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          preferences?: Record<string, unknown>;
          role?: "admin" | "user";
          approval_status?: "pending" | "approved" | "blocked";
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          preferences?: Record<string, unknown>;
          role?: "admin" | "user";
          approval_status?: "pending" | "approved" | "blocked";
          approved_at?: string | null;
          approved_by?: string | null;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let serviceClient: SupabaseClient<DynamicDatabase> | null = null;

export function hasSupabaseServiceRole() {
  return Boolean(env.supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdminClient() {
  if (!env.supabaseUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  }

  if (!serviceClient) {
    serviceClient = createClient<DynamicDatabase>(env.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serviceClient;
}
