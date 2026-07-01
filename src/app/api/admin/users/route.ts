import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureUserAccess } from "@/lib/admin/access";
import { jsonError, parseJson } from "@/lib/api/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient, hasSupabaseServiceRole } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const UpdateUserInput = z.object({
  userId: z.string().uuid(),
  approvalStatus: z.enum(["pending", "approved", "blocked"]).optional(),
  role: z.enum(["admin", "user"]).optional(),
});

type UserProfileRow = {
  id: string;
  display_name: string | null;
  role: "admin" | "user";
  approval_status: "pending" | "approved" | "blocked";
  approved_at: string | null;
  approved_by: string | null;
  created_at?: string;
  updated_at?: string;
};

async function supabaseServiceRest<T>(path: string, init?: RequestInit) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role não configurada.");

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data && typeof data === "object" && "message" in data ? String(data.message) : "") || "Consulta administrativa falhou.");
  }
  return data as T;
}

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return { error: jsonError("Sessão expirada.", 401) };

  const access = await ensureUserAccess(supabase, user);
  if (!access.isAdmin) return { error: jsonError("Acesso restrito ao administrador principal.", 403) };
  if (!hasSupabaseServiceRole()) return { error: jsonError("SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.", 500) };

  return { user };
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  const service = getSupabaseAdminClient();
  const [{ data: authUsers, error: authError }, profiles] = await Promise.all([
    service.auth.admin.listUsers({ page: 1, perPage: 200 }),
    supabaseServiceRest<UserProfileRow[]>("user_profiles?select=id,display_name,role,approval_status,approved_at,approved_by,created_at,updated_at&order=created_at.desc"),
  ]);

  if (authError) return jsonError("Não foi possível listar usuários do Auth.", 500);

  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const users = (authUsers.users || []).map((authUser) => {
    const profile = profilesById.get(authUser.id);
    return {
      id: authUser.id,
      email: authUser.email,
      createdAt: authUser.created_at,
      lastSignInAt: authUser.last_sign_in_at,
      displayName: profile?.display_name || authUser.user_metadata?.name || authUser.email || "Usuário",
      role: profile?.role || "user",
      approvalStatus: profile?.approval_status || "pending",
      approvedAt: profile?.approved_at || null,
      approvedBy: profile?.approved_by || null,
    };
  });

  return NextResponse.json({ users });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  const parsed = UpdateUserInput.safeParse(await parseJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Entrada inválida.");

  const { userId, approvalStatus, role } = parsed.data;
  if (userId === admin.user.id && (approvalStatus === "blocked" || role === "user")) {
    return jsonError("Você não pode remover seu próprio acesso administrativo.", 400);
  }

  const service = getSupabaseAdminClient();
  const { data: authUserResult, error: authError } = await service.auth.admin.getUserById(userId);
  if (authError || !authUserResult.user) return jsonError("Usuário não encontrado no Auth.", 404);

  const existingProfiles = await supabaseServiceRest<Pick<UserProfileRow, "role" | "approval_status">[]>(
    `user_profiles?id=eq.${encodeURIComponent(userId)}&select=role,approval_status&limit=1`,
  );
  const existingProfile = existingProfiles[0];

  const nextRole = role || existingProfile?.role || "user";
  const nextApprovalStatus = approvalStatus || existingProfile?.approval_status || "pending";
  const approved = nextApprovalStatus === "approved";
  const patch = {
    id: userId,
    display_name: authUserResult.user.user_metadata?.name || authUserResult.user.email || "Usuário",
    role: nextRole,
    approval_status: nextApprovalStatus,
    approved_at: approved ? new Date().toISOString() : null,
    approved_by: approved ? admin.user.id : null,
    updated_at: new Date().toISOString(),
  };

  const data = await supabaseServiceRest<UserProfileRow[]>("user_profiles?on_conflict=id&select=id,display_name,role,approval_status,approved_at,approved_by", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(patch),
  });

  if (!data[0]) return jsonError("Não foi possível atualizar o usuário.", 500);

  if (approved && !authUserResult.user.email_confirmed_at) {
    const confirmed = await service.auth.admin.updateUserById(userId, { email_confirm: true });
    if (confirmed.error) return jsonError("Usuário aprovado, mas não foi possível confirmar o e-mail no Auth.", 500);
  }

  return NextResponse.json({ user: data[0] });
}
