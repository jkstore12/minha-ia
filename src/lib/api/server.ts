import { NextResponse } from "next/server";
import { ensureUserAccess } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

export async function getAuthedSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null };
  }

  const access = await ensureUserAccess(supabase, user);
  if (!access.isApproved) {
    return { supabase, user: null, access };
  }

  return { supabase, user, access };
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function parseJson(request: Request) {
  return request.json().catch(() => null);
}
