import { redirect } from "next/navigation";
import { AppShell } from "@/components/platform/app-shell";
import { SetupWarning } from "@/components/setup-warning";
import { ensureUserAccess } from "@/lib/admin/access";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!hasSupabaseEnv()) return <SetupWarning />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  const access = await ensureUserAccess(supabase, user);
  if (!access.isApproved) redirect("/pending");

  return <AppShell userEmail={user.email} isAdmin={access.isAdmin}>{children}</AppShell>;
}
