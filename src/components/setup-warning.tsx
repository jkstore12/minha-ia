export function SetupWarning() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-white px-4 py-6 text-zinc-950 sm:px-6">
      <section className="w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm sm:p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-700">Configuração pendente</p>
        <h1 className="mt-3 text-2xl font-semibold">Conecte o Supabase para usar a Minha IA</h1>
        <p className="mt-3 text-sm leading-6 text-amber-900">
          Preencha as variaveis do Supabase em `.env.local`, aplique a migração SQL em
          `supabase/migrations/0001_initial_schema.sql` e reinicie o servidor.
        </p>
        <a
          href="/setup"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Ver setup
        </a>
      </section>
    </main>
  );
}
