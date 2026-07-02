# Arquitetura do Minha IA

Documento de topologia para contribuidores. Cobre os componentes principais, fluxo de dados, integracoes externas, e decisoes de design nao-obvias. Para decisoes de longo prazo, veja `docs/adr/`.

## Visao Geral

```
                            +--------------------+
                            |   Browser (React)   |
                            |   Next.js Client    |
                            +----------+---------+
                                       | HTTPS
                            +----------v---------+        +------------------+
                            |   Next.js Server   |<------>|  Supabase Auth   |
                            |   (Vercel)          |        |  + Postgres      |
                            |                    |        |  + Storage       |
                            |  /api/chat          |        |  + pgvector      |
                            |  /api/agents        |        +------------------+
                            |  /api/attachments   |
                            |  /api/cron/*       |        +------------------+
                            |  /api/whatsapp/*    |<------>|  OpenRouter /    |
                            |  /api/telegram/*   |        |  OpenAI / Custom |
                            +----------+---------+        +------------------+
                                       |                +------------------+
                            +----------v---------+<------>|  Upstash Redis   |
                            |   Next.js Server   |        |  (rate limit)    |
                            |   (Vercel)          |        +------------------+
                            |                    |
                            |  /api/webhook-*     |<------>|  Telegram Bot API|
                            |  /api/whatsapp-qrcode|<----->|  Evolution API   |
                            +--------------------+        +------------------+
                                                        |  Whisper Large V3|
                                                        |  (transcricao)   |
                                                        +------------------+
```

## Camadas

### 1. Cliente (Next.js App Router)

- **`src/app/(platform)/`** — rotas autenticadas: chat, dashboard, agents, memory, scheduler, settings, abilities, logs, admin/users.
- **`src/app/login/`, `src/app/cadastro/`, `src/app/auth/`** — auth pages + callback.
- **`src/app/setup/`** — status de producao local (helpers de troubleshooting).
- **`src/components/chat/chat-shell.tsx`** — UI principal do chat. Gerencia gravacao de audio, upload, streaming de mensagens, optimistic UI.
- **`src/components/platform/`** — dashboard, form controls, resource pages.

Server components por padrao. Client components (`"use client"`) sao minoria: chat-shell, audio recorder, tool center, admin approval panel.

### 2. API Routes (`src/app/api/`)

Rotas Next.js serverless com `runtime = "nodejs"`. **Todas** as rotas de mutacao validam input com Zod, autenticam via Supabase Auth, e retornam envelopes `{ error: string }` em caso de erro.

| Rota | Responsabilidade |
|---|---|
| `POST /api/chat` | Chat principal: prompt assembly, fallback chain, persistencia, learning. Emite `x-request-id`. |
| `POST /api/agents`, `GET /api/agents` | CRUD de agentes. |
| `POST /api/agents/[id]/knowledge` | Knowledge base por agente, com embeddings via pgvector. |
| `POST /api/attachments` | Upload de arquivo para Supabase Storage. Magic-byte sniffing com `file-type`. |
| `GET /api/attachments/[id]/download` | Download autenticado de anexo. |
| `GET /api/cron/reminders` | Cron handler (Vercel Cron). Fail-closed via `isCronAuthorized`. |
| `GET /api/whatsapp/personal/reports` | Relatorio diario do WhatsApp pessoal. Fail-closed. |
| `GET /api/health` | Healthcheck publico (shallow) e autenticado (deep). Deep mode gated por `ALLOWED_AI_PROBE_HOSTS`. |
| `GET /api/openrouter/models` | Lista de modelos OpenRouter com cache 1h. |
| `POST /api/telegram/link` | Link code do Telegram pessoal. |
| `POST /api/whatsapp/*` | Operacoes WhatsApp (status, preferences, operations). |
| `POST /api/tools` | Tool registry dos agentes. |

### 3. Webhooks (`src/app/api/*/route.ts`)

Tres handlers servidos como Next.js App Router routes, com shape `(Request) => Promise<Response>`:

- `src/app/api/webhook-telegram/route.ts` — recebe updates do Telegram. Fail-closed via `TELEGRAM_WEBHOOK_SECRET` (header `x-telegram-bot-api-secret-token`).
- `src/app/api/webhook-whatsapp/route.ts` — recebe eventos da Evolution API. Fail-closed via `WHATSAPP_WEBHOOK_SECRET` (header `x-webhook-secret` ou query `?secret=`).
- `src/app/api/whatsapp-qrcode/route.ts` — QR code para pareamento WhatsApp.

A logica de cada webhook vive em `src/lib/webhooks/*.js` (shape Vercel legacy `(req, res)`), exposta via `src/lib/api/webhook-adapter.ts` que adapta para o shape App Router. Migracao gradual para `Request/Response` nativo é o proximo passo natural — mas o adapter ja elimina a dependencia de Vercel legacy functions (build unificado pelo Next.js, sem cold start separado, com todos os helpers `src/lib/*` disponiveis).

### 4. Lib (`src/lib/`)

Logica de negocio extraida das rotas. Sem efeitos colaterais de request/response.

- **`ai/brain.ts`** — orquestrador do chat: prompt assembly, fallback chain (primary + `AI_FALLBACK_MODELS`), multimodal payload, `extractBrainUpdates` (memoria + summary).
- **`ai/models.ts`** — `resolveRuntimeModel`, `resolveModelCandidates`, presets de modelos.
- **`ai/embeddings.ts`** — geracao e busca por similaridade vetorial via pgvector.
- **`ai/audio.ts`** — transcricao via Whisper Large V3 (OpenRouter).
- **`ai/context.ts`** — montagem do contexto (historico, memories, agents, knowledge, attachments).
- **`agent/actions.ts`** — actions que o agente executa (memory, task, reminder, link fetch com SSRF protection).
- **`agent/agent-templates.ts`** — templates de agentes pre-definidos.
- **`chat/attachments.ts`** — magic-byte sniffing, MIME allow-list, helpers de MIME.
- **`user-preferences.ts`** — schema Zod nested com defaults; `parseUserPreferences` usa `z.catch` para graceful degradation.
- **`supabase/server.ts`**, `supabase/browser.ts`, `supabase/admin.ts`, `supabase/proxy.ts`** — clients Supabase por contexto.
- **`cron-auth.ts`** — `isCronAuthorized` (timingSafeEqual, fail-closed).
- **`log.ts`** — logger estruturado com PII redaction e correlation id.
- **`rate-limit.ts`** — in-memory + Upstash Redis. Por usuario, por minuto/dia.
- **`env.ts`** — env vars parseadas com defaults e bounds.
- **`proxy.ts`** — middleware Next.js (atualiza sessao Supabase).

## Fluxo de Dados: Chat

```
Browser (ChatShell)
  | POST /api/chat { message, conversationId?, model?, attachments? }
  v
src/app/api/chat/route.ts
  | 1. validate Zod (uuid, length, count)
  | 2. auth.getUser (Supabase)
  | 3. rate-limit consume (per-minute, per-day)
  | 4. fetch attachments from Storage, prepare (text/audio/image/pdf)
  | 5. ensure conversation exists (or create)
  | 6. fetch context: messages, memories, agents, RAG via pgvector
  | 7. resolve model candidates (primary + AI_FALLBACK_MODELS)
  | 8. call brain.runBrain:
  |      - build system prompt (with active agent, user prefs)
  |      - call client.chat.completions.create (primary)
  |      - on error, try next candidate
  |      - on all-fail, throw "Todos os modelos falharam."
  | 9. save messages, agent_logs
  | 10. after() async: extractBrainUpdates (memory + summary), persist
  v
Response { conversationId, assistantMessage, model, usedModel, ... }
  | x-request-id header
```

## Fluxo de Dados: Telegram Bot

```
Telegram user sends message
  v
api.telegram.org -> POST /api/webhook-telegram (Next.js App Router)
  | header x-telegram-bot-api-secret-token == TELEGRAM_WEBHOOK_SECRET (fail-closed)
  v
src/app/api/webhook-telegram/route.ts -> src/lib/webhooks/telegram.js
  | 1. dedupe by update_id (in-memory, scoped to function instance)
  | 2. classify: text / audio / photo / pdf / callback
  | 3. transcribe audio via Whisper (if needed)
  | 4. call askOpenRouter or model-specific handler
  | 5. send response via Telegram sendMessage
  v
Telegram delivers to user
```

## Fluxo de Dados: WhatsApp (Evolution API)

```
WhatsApp user sends message -> Evolution API
  v
Evolution API -> POST /api/webhook-whatsapp (Next.js App Router)
  | header x-webhook-secret (or ?secret=) == WHATSAPP_WEBHOOK_SECRET (fail-closed)
  v
src/app/api/webhook-whatsapp/route.ts -> src/lib/webhooks/whatsapp.js
  | 1. dedupe by messageId
  | 2. load runtime config (bot enabled, owner check, agent selection)
  | 3. classify: command / text / audio / image / unsupported
  | 4. handle accordingly (owner commands, knowledge capture, reminder, chat)
  | 5. send response via Evolution API
  v
Evolution API -> WhatsApp
```

## Persistencia

### Supabase Postgres

Tabelas principais (migrations em `supabase/migrations/`):
- `user_profiles` — `id`, `display_name`, `role`, `approval_status`, `preferences` (jsonb), `approved_by/approved_at`.
- `conversations` — `user_id`, `title`, `summary` (gerado por `extractBrainUpdates`).
- `messages` — `conversation_id`, `user_id`, `role`, `content`.
- `message_attachments` — link mensagem -> storage path.
- `memories` — `user_id`, `kind` (preference/goal/fact/style/constraint), `content`, `confidence`, `source_conversation_id`.
- `agents` — `user_id`, `name`, `domain`, `description`, `system_prompt`, `tools[]`, `model`, `is_orchestrator`, `is_fallback`.
- `agent_knowledge` — knowledge base por agente, com `embedding vector(1536)` (pgvector).
- `scheduled_tasks` — tasks agendadas com `cron_expression`, `next_run_at`, `notification_status`, `metadata.reminder.*`.
- `task_executions` — historico de execucao.
- `connector_*` — integracoes externas.
- `whatsapp_personal_messages` — log de mensagens pessoais.
- `schema_migrations` — tracking de migrations (gerenciado por `scripts/apply-migrations.mjs`).

### Supabase Storage

- `chat-attachments` (privado, 25 MB max, RLS por `user_id`).

### Upstash Redis (opcional)

- Rate limit distribuido para ambientes multi-instancia. Sem isso, o rate limit e in-memory (single-process).

## Seguranca

| Camada | Mecanismo |
|---|---|
| Auth | Supabase Auth (email/password), admin approval via `approval_status`. |
| Authz | RLS no Supabase por `user_id`. Service role usada apenas em server-side. |
| Webhooks | Fail-closed: secret configurado OU retorna 503 (Telegram/WhatsApp). `crypto.timingSafeEqual`. |
| Cron | Fail-closed: `CRON_SECRET` configurado OU retorna 401. `crypto.timingSafeEqual`. |
| Upload | Magic-byte sniffing (`file-type`), `ALLOWED_ATTACHMENT_MIMES` allow-list, 415 em tipo nao permitido. |
| SSRF | `isBlockedHost` + `resolveAndCheckAddress` (DNS rebinding mitigation) com `BlockList` para RFC1918/loopback/ULA. |
| Health | `ALLOWED_AI_PROBE_HOSTS` allow-list evita leak de `AI_API_KEY` em deep mode. Shallow mode nao expoe `provider`/`model`. |
| Cache | Download de anexos: `Cache-Control: private, no-store` (PII). |
| Logging | `redactPII` em `chat_id`, `phone`, `text`, `body`, `sender`, `authorization`, `apikey`, etc. |

Veja [SECURITY.md](./SECURITY.md) para a politica de disclosure.

## Observabilidade

- **Logger estruturado** (`src/lib/log.ts`): JSON em prod, colorido em dev. Nivel via `LOG_LEVEL`.
- **Correlation id** (`x-request-id`): extraido do header ou gerado. Echoed em todas as responses. Logs carregam o mesmo id.
- **Webhooks** (Telegram/WhatsApp): substituem `console.error` por logger com redaction local.
- **Health**: `/api/health` publico (shallow, scrubbed) + `?deep=1` autenticado (probes reais). `?deep=1` e seguro contra leak de `AI_API_KEY`.
- **Migrations**: `schema_migrations` table tracking cada migration aplicada, com timestamp.

## Decisoes de Design (resumo)

- **Next.js 16 + React 19**: stack atual. Tem breaking changes vs 15; veja `AGENTS.md` antes de mexer.
- **pgvector**: embeddings armazenados em Postgres. Alternativas (Pinecone, Weaviate) adicionariam dependencia externa e custo.
- **Upstash opcional**: rate-limit in-memory para single-instance, Upstash para prod multi-instancia.
- **Evolution API para WhatsApp pessoal**: mais simples que Baileys (que requer persistencia de sessao local). Limita o owner a 1 numero.
- **Fail-closed em webhooks/cron**: o custo de "secret nao configurado" deve ser bloqueado (503/401), nao aceito. Isso forc a o operador a configurar antes de expor.
- **Magic-byte sniffing**: confia no `file.type` do cliente e possivel ataque (`.exe` renomeado). `file-type` e o minimo viavel.

Detalhes completos em `docs/adr/`.

## Limites Conhecidos

- Chat usa streaming via NDJSON (opt-in via `stream: true` no body do /api/chat). Cliente consome `ReadableStream` e renderiza a resposta incrementalmente. Default continua JSON completo para backward compat com webhooks e outros consumers.
- Webhooks foram migrados de `api/*.js` (Vercel legacy) para `src/app/api/*/route.ts` (App Router), com adapter Vercel→Next em `src/lib/api/webhook-adapter.ts`. Proximo passo: rewrite direto em `Request/Response` nativo (sem adapter).
- Bridge local (acesso a filesystem) usa Cloudflare Tunnel + per-action approval. Veja `docs/local-agent-bridge.md`.
- Knowledge extraction roda `after()` (fire-and-forget pos-response). Em Vercel, se a funcao for morta prematuramente, a extracao e perdida. Fila dedicada e o caminho correto a longo prazo.
