import Link from "next/link";
import { CheckCircle2, CircleAlert, Database, KeyRound } from "lucide-react";
import { getSetupStatus } from "@/lib/env";

function StatusRow({
  title,
  description,
  ready,
  missing,
}: {
  title: string;
  description: string;
  ready: boolean;
  missing: string[];
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        {ready ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-5 w-5 text-amber-600" />}
        <div>
          <h2 className="font-semibold text-zinc-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>
          {missing.length ? (
            <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
              Falta preencher: {missing.join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function SetupPage() {
  const setup = getSetupStatus();
  const ready = setup.supabase.configured && setup.ai.configured;

  return (
    <main className="min-h-[100dvh] bg-white px-4 py-8 text-zinc-950 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Minha IA</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Setup para uso real</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
          O projeto já está implementado. Para operar de verdade, preencha o `.env.local`, aplique a migração no Supabase
          e reinicie o servidor.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <StatusRow
            title="Supabase"
            description="Login, histórico, conversas e memória persistente por usuário."
            ready={setup.supabase.configured}
            missing={setup.supabase.missing}
          />
          <StatusRow
            title="IA"
            description={`Provedor: ${setup.ai.provider}. Modelo padrão: ${setup.ai.model}.`}
            ready={setup.ai.configured}
            missing={setup.ai.missing}
          />
        </div>

        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Database className="h-5 w-5 text-emerald-600" />
            Banco de dados
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            No Supabase SQL Editor, execute o arquivo `supabase/setup.sql`. Ele cria login, conversas, mensagens,
            memória, agentes, conectores, tarefas, logs, indices e políticas RLS.
          </p>
        </section>

        <section className="mt-4 rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-5 w-5 text-emerald-600" />
            Chave de IA
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-600">
            O `.env.local` já está configurado para OpenRouter. Cole sua chave em `OPENROUTER_API_KEY`. Depois você pode
            trocar modelos diretamente na tela do chat.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={ready ? "/chat" : "/login"}
            className="inline-flex h-11 items-center justify-center rounded-md bg-emerald-400 px-4 font-semibold text-zinc-950 transition hover:bg-emerald-300"
          >
            Abrir Minha IA
          </Link>
          <Link
            href="/api/health"
            className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-200 px-4 font-semibold text-zinc-800 transition hover:bg-zinc-100"
          >
            Ver healthcheck
          </Link>
        </div>
      </div>
    </main>
  );
}
