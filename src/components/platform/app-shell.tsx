"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, BellRing, Bot, CalendarClock, Database, KeyRound, LogOut, Menu, MessageSquare, PlugZap, ScrollText, Settings2, ShieldCheck, Wrench, X } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import { createClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const baseNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/abilities", label: "Habilidades", icon: BellRing, reminderBadge: true },
  { href: "/agents", label: "Agentes", icon: Bot },
  { href: "/tools", label: "Ferramentas", icon: Wrench },
  { href: "/connectors", label: "Conectores", icon: PlugZap },
  { href: "/memory", label: "Memória", icon: Database },
  { href: "/scheduler", label: "Agenda", icon: CalendarClock },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Configurações", icon: Settings2 },
  { href: "/setup", label: "Setup", icon: KeyRound },
];

export function AppShell({ children, userEmail, isAdmin = false }: { children: React.ReactNode; userEmail?: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dueReminders, setDueReminders] = useState(0);
  const navItems = isAdmin
    ? [...baseNavItems.slice(0, 4), { href: "/admin/users", label: "Usuários", icon: ShieldCheck }, ...baseNavItems.slice(4)]
    : baseNavItems;
  const bottomNavItems = [
    { href: "/dashboard", label: "Início", icon: BarChart3 },
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/abilities", label: "Lembretes", icon: BellRing, reminderBadge: true },
    { href: "/agents", label: "Agentes", icon: Bot },
  ];

  useEffect(() => {
    let active = true;

    async function refreshDueReminders() {
      try {
        const response = await fetch("/api/scheduler", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { tasks?: Array<{ is_active?: boolean; next_run_at?: string | null }> };
        const now = Date.now();
        const count = (payload.tasks || []).filter((task) => {
          if (!task.is_active || !task.next_run_at) return false;
          const time = new Date(task.next_run_at).getTime();
          return Number.isFinite(time) && time <= now;
        }).length;
        if (active) setDueReminders(count);
      } catch {
        if (active) setDueReminders(0);
      }
    }

    void refreshDueReminders();
    const interval = window.setInterval(refreshDueReminders, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pathname]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const nav = (
    <>
      <div className="flex items-center gap-3">
        <AppLogo className="h-10 w-10" />
        <div>
          <p className="font-semibold">Minha IA</p>
          <p className="text-xs text-zinc-500">Orquestrador profissional</p>
        </div>
      </div>

      <nav className="mt-7 flex-1 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition duration-200 active:scale-[0.99]",
                active ? "bg-zinc-950 text-white shadow-sm" : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.reminderBadge && dueReminders > 0 ? (
                <span
                  aria-label={`${dueReminders} lembrete${dueReminders === 1 ? "" : "s"} pendente${dueReminders === 1 ? "" : "s"}`}
                  className={cn(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                    active ? "bg-white text-zinc-950" : "bg-emerald-100 text-emerald-700",
                  )}
                >
                  {dueReminders > 9 ? "9+" : dueReminders}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 pt-4 text-xs text-zinc-500">
        <p className="truncate">{userEmail}</p>
        <button onClick={signOut} className="mt-3 inline-flex items-center gap-2 text-zinc-700 transition hover:text-zinc-950">
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </>
  );

  return (
    <main className="flex min-h-[100dvh] overflow-x-hidden bg-white text-zinc-950">
      <aside className="hidden w-72 shrink-0 border-r border-zinc-200 bg-white p-4 lg:flex lg:flex-col">
        {nav}
      </aside>

      {mobileOpen ? (
        <div className="animate-app-fade fixed inset-0 z-50 lg:hidden">
          <button aria-label="Fechar menu" className="absolute inset-0 bg-black/25" onClick={() => setMobileOpen(false)} />
          <aside className="animate-slide-in-left relative flex h-full w-[min(82vw,320px)] flex-col border-r border-zinc-200 bg-white p-4 shadow-2xl">
            <button
              aria-label="Fechar menu"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 transition hover:bg-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
            {nav}
          </aside>
        </div>
      ) : null}

      <section className="min-w-0 flex-1 bg-white pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:pb-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              aria-label="Abrir menu"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-800 transition hover:bg-zinc-100"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <p className="font-semibold">Minha IA</p>
              <p className="text-xs text-zinc-500">Orquestrador</p>
            </div>
          </div>
          <div className="hidden text-sm text-zinc-500 lg:block">Sistema multiagente com memória, conectores, agenda e logs.</div>
          <button onClick={signOut} className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-800 transition hover:bg-zinc-100 lg:hidden">
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </header>
        <div className="animate-app-fade-up mx-auto w-full max-w-[1440px] min-w-0 p-4 pb-6 lg:p-8">{children}</div>
      </section>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition active:scale-[0.98]",
                  active ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="max-w-full truncate px-1">{item.label}</span>
                {item.reminderBadge && dueReminders > 0 ? <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-emerald-500" /> : null}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 active:scale-[0.98]"
          >
            <Menu className="h-4 w-4" />
            Mais
          </button>
        </div>
      </nav>
    </main>
  );
}
