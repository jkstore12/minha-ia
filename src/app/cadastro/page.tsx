import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { SetupWarning } from "@/components/setup-warning";
import { hasSupabaseEnv } from "@/lib/env";

export default function SignupPage() {
  if (!hasSupabaseEnv()) return <SetupWarning />;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white px-4 py-6 text-zinc-950 sm:px-6">
      <section className="w-full max-w-md">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Minha IA</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Crie sua conta</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Use um e-mail e uma senha nova para acessar o app em qualquer celular. Seu histórico e suas memórias ficam vinculados a esse usuário.
        </p>
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:mt-8 sm:p-5">
          <Suspense fallback={<div className="h-56 animate-pulse rounded-md bg-zinc-100" />}>
            <AuthForm mode="signup" />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
