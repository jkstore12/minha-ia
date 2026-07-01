"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

type AuthFormProps = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function authErrorMessage(value: unknown) {
    const raw = value instanceof Error ? value.message : String(value || "");
    const normalized = raw.toLowerCase();

    if (normalized.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
    if (normalized.includes("e-mail not confirmed")) return "Confirme seu e-mail antes de entrar.";
    if (normalized.includes("user already registered") || normalized.includes("already registered")) return "Esse e-mail já tem uma conta. Use Entrar.";
    if (normalized.includes("signup") && normalized.includes("disabled")) return "Cadastro desativado no Supabase. Ative E-mail/Password em Authentication.";
    if (normalized.includes("password")) return "A senha precisa cumprir as regras do Supabase. Use pelo menos 6 caracteres.";
    if (normalized.includes("rate limit")) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";

    return raw || "Não foi possível autenticar.";
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    if (mode === "signup" && password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }

    if (mode === "signup" && password.length < 6) {
      setError("Use uma senha com pelo menos 6 caracteres.");
      return;
    }

    setIsLoading(true);

    try {
      const supabase = createClient();

      if (mode === "signup") {
        const registerResponse = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: cleanName, email: cleanEmail, password }),
        });
        const registerPayload = await registerResponse.json().catch(() => ({}));

        if (!registerResponse.ok) throw new Error(registerPayload.error || "Não foi possível criar sua conta.");

        const { error: signInAfterRegisterError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (signInAfterRegisterError) throw signInAfterRegisterError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (signInError) throw signInError;
      }

      router.push(mode === "signup" ? "/pending" : searchParams.get("redirectedFrom") || "/chat");
      router.refresh();
    } catch (authError) {
      setError(authErrorMessage(authError));
    } finally {
      setIsLoading(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <form onSubmit={onSubmit} className="w-full space-y-4">
      {isSignup ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">Nome</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoComplete="name"
            className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:h-11 sm:text-sm"
            placeholder="Seu nome"
          />
        </label>
      ) : null}

      <label className="block space-y-2">
        <span className="text-sm font-medium text-zinc-700">E-mail</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
          inputMode="email"
          className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:h-11 sm:text-sm"
          placeholder="seu@email.com"
        />
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-medium text-zinc-700">Senha</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={6}
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:h-11 sm:text-sm"
          placeholder="mínimo 6 caracteres"
        />
      </label>

      {isSignup ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-zinc-700">Confirmar senha</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className="h-12 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 sm:h-11 sm:text-sm"
            placeholder="repita sua senha"
          />
        </label>
      ) : null}

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p> : null}

      <button
        type="submit"
        disabled={isLoading}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 sm:h-11"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isSignup ? "Criar conta" : "Entrar"}
      </button>

      <p className="text-center text-sm text-zinc-500">
        {isSignup ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
        <Link className="font-medium text-zinc-950 underline underline-offset-4 hover:text-zinc-700" href={isSignup ? "/login" : "/cadastro"}>
          {isSignup ? "Entrar" : "Criar conta"}
        </Link>
      </p>

      {!isSignup ? (
        <p className="text-center text-xs leading-5 text-zinc-400">
          Em outro celular, use o mesmo e-mail e senha. Se ainda não tem usuário, toque em Criar conta.
        </p>
      ) : null}
    </form>
  );
}
