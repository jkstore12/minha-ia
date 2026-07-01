import { redirect } from "next/navigation";
import { PendingAccount } from "@/components/auth/pending-account";
import { ensureUserAccess } from "@/lib/admin/access";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  if (!hasSupabaseEnv()) redirect("/setup");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const access = await ensureUserAccess(supabase, user);
  if (access.isApproved) redirect("/chat");

  return <PendingAccount e-mail={user.email} status={access.approvalStatus === "blocked" ? "blocked" : "pending"} />;
}
