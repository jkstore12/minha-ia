"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, ShieldX, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

type ManagedUser = {
  id: string;
  email?: string | null;
  createdAt?: string | null;
  lastSignInAt?: string | null;
  displayName: string;
  role: "admin" | "user";
  approvalStatus: "pending" | "approved" | "blocked";
  approvedAt?: string | null;
};

function statusLabel(status: ManagedUser["approvalStatus"]) {
  if (status === "approved") return "Aprovado";
  if (status === "blocked") return "Bloqueado";
  return "Pendente";
}

function formatDate(value?: string | null) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function UserApprovalPanel() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  async function loadUsers() {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/admin/users", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar usuários.");
      setUsers(payload.users || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar usuários.");
    } finally {
      setLoading(false);
    }
  }

  async function updateUser(userId: string, update: Partial<Pick<ManagedUser, "approvalStatus" | "role">>) {
    setSavingId(userId);
    setError(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...update }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar usuário.");
      await loadUsers();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Não foi possível atualizar usuário.");
    } finally {
      setSavingId(null);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) => `${user.email || ""} ${user.displayName} ${user.approvalStatus} ${user.role}`.toLowerCase().includes(term));
  }, [query, users]);

  const counts = useMemo(() => {
    return users.reduce(
      (acc, user) => {
        acc[user.approvalStatus] += 1;
        return acc;
      },
      { pending: 0, approved: 0, blocked: 0 },
    );
  }, [users]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Administração</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Aprovação de contas</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
              Novos usuários ficam pendentes até você aprovar. Use esta tela para liberar, bloquear ou definir administradores.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Pendentes", counts.pending, "bg-amber-50 text-amber-800"],
            ["Aprovados", counts.approved, "bg-emerald-50 text-emerald-800"],
            ["Bloqueados", counts.blocked, "bg-rose-50 text-rose-800"],
          ].map(([label, value, color]) => (
            <div key={label} className={cn("rounded-xl px-4 py-3", String(color))}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nome, e-mail ou status"
            className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:max-w-sm sm:text-sm"
          />
          <span className="text-sm text-zinc-500">{filteredUsers.length} usuário(s)</span>
        </div>

        {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando usuários...
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            {filteredUsers.map((user) => (
              <article key={user.id} className="rounded-xl border border-zinc-200 p-3 sm:p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold text-zinc-950">{user.displayName}</h2>
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-xs font-semibold",
                          user.approvalStatus === "approved" && "bg-emerald-50 text-emerald-700",
                          user.approvalStatus === "pending" && "bg-amber-50 text-amber-700",
                          user.approvalStatus === "blocked" && "bg-rose-50 text-rose-700",
                        )}
                      >
                        {statusLabel(user.approvalStatus)}
                      </span>
                      {user.role === "admin" ? <span className="rounded-full bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">Admin</span> : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-zinc-500">{user.email || "E-mail não informado"}</p>
                    <p className="mt-1 text-xs text-zinc-400">Último acesso: {formatDate(user.lastSignInAt)}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                    <button
                      type="button"
                      disabled={savingId === user.id}
                      onClick={() => void updateUser(user.id, { approvalStatus: "approved" })}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Aprovar
                    </button>
                    <button
                      type="button"
                      disabled={savingId === user.id}
                      onClick={() => void updateUser(user.id, { approvalStatus: "blocked" })}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60"
                    >
                      <ShieldX className="h-4 w-4" />
                      Bloquear
                    </button>
                    <button
                      type="button"
                      disabled={savingId === user.id}
                      onClick={() => void updateUser(user.id, { role: user.role === "admin" ? "user" : "admin", approvalStatus: "approved" })}
                      className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60 sm:col-span-1"
                    >
                      {user.role === "admin" ? <UserCog className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                      {user.role === "admin" ? "Remover admin" : "Tornar admin"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {!filteredUsers.length ? <p className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">Nenhum usuário encontrado.</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}
