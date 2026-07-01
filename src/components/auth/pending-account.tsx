"use client";

import { LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export function PendingAccount({ email, status }: { email?: string; status: "pending" | "blocked" }) {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white px-4 py-8 text-zinc-950">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          {status === "blocked" ? "Conta bloqueada" : "Aguardando aprovação"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          {status === "blocked"
            ? "Essa conta não está liberada para acessar o sistema. Fale com o administrador principal."
            : "Sua conta foi criada com segurança e precisa ser aprovada pelo administrador principal antes de usar o app."}
        </p>
        <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {email || "Usuário autenticado"}
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => router.refresh()}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            <RefreshCw className="h-4 w-4" />
            Verificar agora
          </button>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-200 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </div>
      </section>
    </main>
  );
}
