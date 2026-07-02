# ADR-0001: Next.js 16 + React 19 como framework

- **Status**: Aceito
- **Data**: 2026-05 (inicial), revisado 2026-07
- **Decisor**: @jkstore12

## Contexto

O projeto precisa de um framework full-stack que suporte:
- App Router (file-system routing com layouts e server components).
- API routes com `runtime = "nodejs"` (necessario para `pg`, `crypto`, `node:dns`).
- Serverless deployment (Vercel).
- Streaming de responses.
- RSC (React Server Components) para reduzir JS no client.

Alternativas consideradas:
- **Next.js 15**: estavel, mas perde features que ja exploramos (App Router, Turbopack, Server Actions).
- **Remix**: menor ecossistema de hospedagem serverless. Sem equivalente direto a Vercel Functions.
- **SvelteKit**: comunidade menor. Equipe mais familiar com React.
- **Express + React separado**: mais boilerplate, sem file-system routing.

## Decisao

Adotamos **Next.js 16.2.6** com **React 19.2.4**, deploy em **Vercel**.

## Consequencias

### Positivas
- File-system routing reduz boilerplate.
- Vercel Functions sao cold-start otimizados para Next.js.
- Suporte oficial a streaming, Server Actions, RSC.
- Ecossistema grande (Supabase, OpenAI, etc tem SDKs/guides).

### Negativas
- **Next.js 16 tem breaking changes vs 15**: middleware em `src/proxy.ts` (nao mais `src/middleware.ts`), `params: Promise<...>` em rotas dinamicas, headers via `headers()` agora async, novos defaults em `next.config.ts`. Contribuidores precisam ler [AGENTS.md](../../AGENTS.md) antes de mexer.
- React 19 introduziu `use()` para promises, novas regras de hooks. Cuidado com libs de terceiros.
- Turbopack ainda nao e 100% equivalente ao Webpack. Builds de producao podem ter warnings.
- Vendor lock-in parcial: migrar para outro framework (Remix, SvelteKit) exigiria reescrita substancial.

### Riscos
- Breaking change de minor: monitorar release notes do Next.js e atualizar [AGENTS.md](../../AGENTS.md) proativamente.

## Referencias

- [Next.js 16 release notes](https://nextjs.org/blog)
- [AGENTS.md](../../AGENTS.md) — notas para contribuidores
- [Next.js App Router docs](https://nextjs.org/docs/app)
