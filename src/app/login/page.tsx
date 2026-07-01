import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { SetupWarning } from "@/components/setup-warning";
import { hasSupabaseEnv } from "@/lib/env";

export default function LoginPage() {
  if (!hasSupabaseEnv()) return <SetupWarning />;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white px-4 py-6 text-zinc-950 sm:px-6">
      <section className="w-full max-w-md">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Minha IA</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Entre no seu cerebro de IA</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Acesse seu assistente pessoal com memória persistente e modelo configuravel.
        </p>
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:mt-8 sm:p-5">
          <Suspense fallback={<div className="h-44 animate-pulse rounded-md bg-zinc-100" />}>
            <AuthForm mode="login" />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
