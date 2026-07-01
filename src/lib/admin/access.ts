import type { SupabaseClient, User } from "@supabase/supabase-js";

export type ApprovalStatus = "pending" | "approved" | "blocked";
export type UserRole = "admin" | "user";

export type UserAccess = {
  role: UserRole;
  approvalStatus: ApprovalStatus;
  isAdmin: boolean;
  isApproved: boolean;
  displayName: string;
};

function parseAdminEmails() {
  return (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null) {
  if (!email) return false;
  return parseAdminEmails().includes(email.trim().toLowerCase());
}

function normalizeRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "user";
}

function normalizeApprovalStatus(value: unknown): ApprovalStatus {
  if (value === "approved" || value === "blocked" || value === "pending") return value;
  return "pending";
}

export async function ensureUserAccess(supabase: SupabaseClient, user: User): Promise<UserAccess> {
  const displayName = String(user.user_metadata?.name || user.email || "Usuário");
  const adminByEnv = isAdminEmail(user.email);

  const { data: existing } = await supabase
    .from("user_profiles")
    .select("display_name, role, approval_status")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    const role: UserRole = adminByEnv ? "admin" : "user";
    const approvalStatus: ApprovalStatus = adminByEnv ? "approved" : "pending";

    await supabase.from("user_profiles").insert({
      id: user.id,
      display_name: displayName,
      role,
      approval_status: approvalStatus,
      approved_at: approvalStatus === "approved" ? new Date().toISOString() : null,
    });

    return {
      role,
      approvalStatus,
      isAdmin: role === "admin" && approvalStatus === "approved",
      isApproved: approvalStatus === "approved",
      displayName,
    };
  }

  const role = normalizeRole(existing.role);
  const approvalStatus = normalizeApprovalStatus(existing.approval_status);

  return {
    role,
    approvalStatus,
    isAdmin: adminByEnv || (role === "admin" && approvalStatus === "approved"),
    isApproved: adminByEnv || approvalStatus === "approved",
    displayName: String(existing.display_name || displayName),
  };
}
