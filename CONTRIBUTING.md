# Contribuindo com o Minha IA

Obrigado por contribuir. Este documento cobre o setup de desenvolvimento, workflow de PR, e convencoes do projeto.

## Setup Local

Pre-requisitos:
- **Node.js 20+** (o projeto roda CI em Node 20 e 22)
- **npm** (lockfile e `engines` sao npm)
- **Supabase** — projeto gratis em [supabase.com](https://supabase.com)
- Opcional: conta no [OpenRouter](https://openrouter.ai), [Telegram](https://t.me/BotFather), [Evolution API](https://evolution-api.com), [Upstash](https://upstash.com)

```bash
# 1. Clone
git clone https://github.com/jkstore12/minha-ia.git
cd minha-ia

# 2. Instalar deps
npm install

# 3. Configurar envs
cp .env.example .env.local
# Edite .env.local com suas chaves Supabase + OpenRouter (minimo para rodar)

# 4. Aplicar migrations no Supabase
node scripts/apply-migrations.mjs
# Vai pedir a database password

# 5. Rodar
npm run dev
# Abra http://localhost:3000
```

Para acesso via LAN (celular, outro PC na mesma rede):
```bash
npm run dev:lan
# Descubra o IP com `ipconfig` e acesse http://SEU-IP:3000
```

## Workflow de Desenvolvimento

### Branches

- `main` — deploy de producao. So recebe merges via PR.
- `feat/descricao-curta` — feature nova.
- `fix/descricao-curta` — bug fix.
- `chore/descricao-curta` — manutencao semmudanca de comportamento.
- `docs/descricao-curta` — so documentacao.

### Commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org/) no escopo:

```
feat(scope): description
fix(scope): description
chore(scope): description
docs(scope): description
test(scope): description
refactor(scope): description
```

Exemplos:
```
feat(chat): add streaming response support
fix(webhook-whatsapp): reject requests with mismatched secret
chore(deps): bump file-type to 22.0.1
```

### Pull Requests

1. Crie uma branch a partir de `main`.
2. Faca commits atomicos (cada commit = uma mudanca logica).
3. Antes de abrir o PR, rode:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```
   Os 3 devem passar limpo. CI roda a mesma triade em Node 20 e 22.
4. Abra o PR usando o template (`.github/PULL_REQUEST_TEMPLATE.md`).
5. Marque as caixas do checklist. Items nao-aplicaveis podem ficar unchecked com explicacao.
6. Aguarde review de pelo menos 1 maintainer.

### Migrations de Banco

Se sua mudanca exige alteracao no schema:

1. Crie `supabase/migrations/YYYYMMDDHHMMSS_descricao.sql`.
2. Nunca edite migrations ja commitadas — crie uma nova que faz a alteracao.
3. Teste localmente com `node scripts/apply-migrations.mjs`.
4. Documente no PR:
   - O que a migration faz.
   - Se e breaking (requer backfill, downtime, coordenacao).
   - Migrations sao idempotentes? Se nao, explique.

### Env vars

Novas variaveis precisam:

1. Ser adicionadas em `.env.example` com comentario explicativo.
2. Ser parseadas em `src/lib/env.ts` com tipo, default, e `parseBoolean`/`parseNumber` quando aplicavel.
3. Ser documentadas em `DEPLOY.md` na secao correspondente.
4. Ter fallback seguro (default razoavel ou erro explicito em `requireXxxEnv()`).

Variaveis de servidor (`SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY`, etc.) **nunca** podem ter prefixo `NEXT_PUBLIC_`. Variaveis client-side que precisam ser expostas usam `NEXT_PUBLIC_`.

## Code Style

- **TypeScript strict.** O `tsconfig.json` tem strict mode. Nao use `any` sem comentario explicando por que.
- **ESLint** (config do `next/core-web-vitals`). O CI falha se houver erros. Warnings sao permitidos mas desencorajados.
- **Formatacao**: nao ha Prettier configurado. Mantenha consistencia com o codigo existente (2 spaces, single quotes, trailing commas em multiline).
- **Comentarios**: escreva em ingles para o codigo, portugues para mensagens de UI. Documente **por que** nao **o que**.
- **Nomeacao**:
  - `camelCase` para variaveis, funcoes.
  - `PascalCase` para tipos, classes, componentes React.
  - `SCREAMING_SNAKE_CASE` para constantes de modulo.
  - Prefixo `use` para hooks React.
  - Sufixo `Route` para arquivos em `src/app/api/.../route.ts`.

## Estrutura de Pastas

```
src/
  app/                    # Next.js App Router
    (platform)/           # Rotas autenticadas (dashboard, agents, etc)
    api/                  # API routes
      chat/               # Endpoint principal
      cron/               # Cron handlers (Vercel Cron)
      ...
    auth/, login/, cadastro/
  components/             # Componentes React compartilhados
    chat/                 # ChatShell, etc
    platform/             # Dashboard, form controls
  lib/                    # Logica de negocio
    ai/                   # brain, models, embeddings, audio
    agent/                # actions, agent lifecycle
    chat/                 # attachments, types
    agent-tools/          # registry de tools dos agentes
    orchestrator/         # templates de agentes
    supabase/             # clients Supabase (server, browser, admin, proxy)
    api/                  # server helpers (getAuthedSupabase, jsonError)
  middleware → src/proxy.ts

api/                       # Vercel legacy serverless functions (webhooks)
  webhook-telegram.js
  webhook-whatsapp.js
  whatsapp-qrcode.js

supabase/                  # Setup e migrations do banco
  migrations/             # SQL files em ordem alfabetica
  setup.sql               # Setup completo (legacy, nao usar com script)

scripts/                   # CLI tools (apply-migrations, local-agent-bridge)
docs/                      # Documentos secundarios (local-agent-bridge, adr/)
```

## Agentes de IA

Se voce e um agente de IA editando o codigo:

1. **Leia [AGENTS.md](./AGENTS.md) ANTES de escrever codigo.** Ele contem notas sobre breaking changes do Next.js 16 e outras convencoes que podem nao estar no seu training data.
2. **Rode os 3 comandos de verificacao** (lint, typecheck, test) antes de considerar uma tarefa concluida.
3. **Nao adicione dependencias** sem justificativa clara no PR. Para magic-byte detection usamos `file-type`; para logging usamos um modulo caseiro; para rate-limit usamos `@upstash/ratelimit` quando distribuido ou um fallback in-memory.
4. **Para PRs de seguranca/observabilidade**, prefira refactor incremental e testavel a mudancas de larga escala.

## Reportando Bugs

Use o template de issue `.github/ISSUE_TEMPLATE/bug.md`. Inclua:

- Passos para reproduzir.
- Comportamento esperado vs observado.
- Screenshots/logs quando aplicavel.
- Versao do Node.js, sistema operacional, e se voce esta rodando local ou em producao.

## Reportando Vulnerabilidades de Seguranca

**NAO abra issue publica.** Veja [SECURITY.md](./SECURITY.md) para o canal de disclosure.

## Testes

- Adicione testes para qualquer mudanca de comportamento. O CI verifica que `npm test` passa.
- Para funcoes puras, testes unitarios sao suficientes. Para rotas API, use `jest.unstable_mockModule` para mockar o client Supabase.
- Cobertura minima nao e enforced, mas procuramos manter:
  - Helpers puros: 100%.
  - Rotas API: smoke test do happy path + cada branch de erro.
  - Integracoes externas (webhooks, AI): smoke + edge cases de payload.

## Code Review

O que esperamos de reviews:

- **Seguranca**: mudancas em auth, webhooks, ou upload de arquivos precisam de review extra.
- **Performance**: queries de banco devem usar indices apropriados. AI rate limits nao podem ser regredidos.
- **Compatibilidade**: Next.js 16 tem breaking changes vs 15. Verifique [AGENTS.md](./AGENTS.md) antes de mexer em app router, server components, ou middleware.
- **UX**: textos de UI em portugues do Brasil. Nao introduza secoes em ingles no produto final.

## Licenca

Este projeto e privado (`"private": true` em `package.json`). Contribuicoes sao aceitas apenas de colaboradores com acesso ao repositorio.
