# Guia de Deploy — Minha IA

Este documento cobre o ciclo completo de deploy: setup local, Supabase, secrets, migrations, CI, e Vercel.

> **Pré-requisitos**: Node.js 20+, npm, conta no [Supabase](https://supabase.com), conta no [Vercel](https://vercel.com), opcionalmente conta no [Upstash](https://upstash.com).

---

## 1. Setup local

```bash
# Clone (se ainda nao tiver)
git clone https://github.com/jkstore12/minha-ia.git
cd minha-ia

# Instalar dependencias
npm install

# Copiar env vars
cp .env.example .env.local
# Edite .env.local com suas chaves (veja secao 2 e 3)

# Rodar local
npm run dev
```

Acesse http://localhost:3000.

Para acesso via LAN (celular/outro PC na mesma rede):
```bash
npm run dev:lan
# Descubra seu IP com `ipconfig` e acesse http://SEU-IP:3000
```

---

## 2. Configurar Supabase

### 2.1. Criar projeto
1. https://supabase.com/dashboard → **New project**
2. **Region**: South America (São Paulo) — `sa-east-1`
3. **Database password**: guarde em local seguro (você vai precisar)
4. Aguarde provisionar (~2 min)

### 2.2. Copiar credenciais para `.env.local`
Em **Project Settings → API**:
- `NEXT_PUBLIC_SUPABASE_URL` → **Project URL**
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → **anon public key**
- `SUPABASE_SERVICE_ROLE_KEY` → **service_role secret** ⚠️ server-only, NUNCA exponha no client

### 2.3. Aplicar migrations
**Opção A — via script do projeto (recomendado)**:
```bash
node scripts/apply-migrations.mjs
# Informe a database password do passo 2.1 quando pedir
```

O script lê `supabase/migrations/*.sql` em ordem e aplica cada uma, registrando na tabela `schema_migrations`.

**Opção B — manual via Dashboard**:
1. **SQL Editor** → New query
2. Cole e rode cada arquivo em `supabase/migrations/` em ordem numérica:
   - `0001_initial_schema.sql`
   - `0002_orchestrator_schema.sql`
   - `0003_personal_whatsapp_agent.sql`
   - `0004_agent_knowledge.sql`
   - `0005_message_attachments_storage.sql`
   - `20260606132947_admin_user_approval.sql`
   - `20260611*` (service role grants)
   - `20260612*` (agent metadata, reminder notifications, cron)
   - `20260701_remove_hardcoded_admins.sql`
   - `20260702_agent_knowledge_embeddings.sql` (pgvector + RAG)
3. **Storage** → New bucket:
   - Name: `chat-attachments`
   - Public: **false** (privado)
   - File size limit: 26214400 (25 MB)

### 2.4. Configurar admins (sem hard-coded)
A migration `20260606132947_admin_user_approval.sql` foi editada para **NÃO** promover admins automaticamente. Defina via env:
```bash
# .env.local
ADMIN_EMAILS=seu-email@exemplo.com,outro-admin@exemplo.com
```

### 2.5. Habilitar Auth
**Authentication → Providers → Email**:
- ✅ Enable Email provider
- ❌ Desabilite "Confirm email" (a aplicação já cria usuários com `email_confirm: true`)

---

## 3. Configurar IA

### 3.1. OpenRouter (recomendado — múltiplos modelos com uma chave)
1. https://openrouter.ai → **Keys** → **Create Key**
2. Copie para `.env.local`:
   ```bash
   AI_PROVIDER=openrouter
   OPENROUTER_API_KEY=sk-or-v1-...
   AI_MODEL=openai/gpt-5.4-mini
   AI_FALLBACK_MODELS=openai/gpt-chat-latest,deepseek/deepseek-v4-flash
   ```

### 3.2. OpenAI direto
```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
AI_MODEL=gpt-5.4-mini
```

### 3.3. Custom (qualquer OpenAI-compatible)
```bash
AI_PROVIDER=custom
AI_API_KEY=...
AI_BASE_URL=https://seu-endpoint.com/v1
AI_MODEL=seu-modelo
```

---

## 4. Rate limit distribuído (opcional, recomendado para prod)

Para funcionar corretamente com múltiplas instâncias da Vercel:

1. https://upstash.com → **Create Database**
2. **Region**: mesma da Vercel (ex: `us-east-1` para hkg1)
3. Copie para `.env.local`:
   ```bash
   UPSTASH_REDIS_REST_URL=https://....upstash.io
   UPSTASH_REDIS_REST_TOKEN=AX...
   ```

Sem essas vars, o app usa rate limit in-memory (single-process, OK para dev mas limitado em prod).

---

## 5. Configurar Telegram (opcional)

1. Fale com [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copie o token para `.env.local`:
   ```bash
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_WEBHOOK_SECRET=uma-string-aleatoria-longa
   ```
3. **IMPORTANTE**: defina `TELEGRAM_WEBHOOK_SECRET`. Sem ele, o webhook retorna 503 (fail-closed).
4. Configure o webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://minha-ia-orquestrador.vercel.app/api/webhook-telegram" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

---

## 6. Configurar WhatsApp (opcional, via Evolution API)

```bash
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=...
WHATSAPP_INSTANCE_NAME=minha-ia
WHATSAPP_OWNER_USER_ID=<uuid-do-user-owner-no-supabase>

# Segredo do webhook WhatsApp. OBRIGATORIO em producao.
# O endpoint /api/webhook-whatsapp e fail-closed: sem secret, retorna 503.
# Aceita o header `x-webhook-secret` ou o query param `?secret=<valor>`.
WHATSAPP_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

Como injetar o header (a Evolution API nao envia um header padrao):

**Opcao A — Reverse proxy (Caddy/Nginx)** na frente da Vercel:
```
# Caddy
header_up x-webhook-secret {env.WHATSAPP_WEBHOOK_SECRET}
reverse_proxy minha-ia-orquestrador.vercel.app
```

**Opcao B — Configuracao por instancia na Evolution API** (varia por versao; consulte a doc): procure por "webhook custom headers" ou "webhook headers" nas configuracoes da instancia e adicione `x-webhook-secret: <seu-segredo>`.

**Opcao C — Query string** (menos recomendado, segredo fica em URL/logs):
```
https://minha-ia-orquestrador.vercel.app/api/webhook-whatsapp?secret=<WHATSAPP_WEBHOOK_SECRET>
```

---

## 7. Deploy na Vercel

### 7.1. Conectar (já feito neste repo)
Se ainda não estiver:
1. https://vercel.com/new → **Import Git Repository**
2. Selecione `jkstore12/minha-ia`
3. **Framework Preset**: Next.js (detectado automático)
4. **Build & Output**: defaults

### 7.2. Configurar Environment Variables na Vercel
**Project Settings → Environment Variables**, copie as mesmas do `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` (Production + Preview + Development)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` ⚠️ Production only por segurança
- `AI_PROVIDER`, `OPENROUTER_API_KEY` (ou `OPENAI_API_KEY`)
- `ADMIN_EMAILS`
- (Opcional) `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- (Opcional) `TELEGRAM_*`, `EVOLUTION_API_*`
- `NEXT_PUBLIC_APP_URL` = `https://minha-ia-orquestrador.vercel.app`

### 7.3. Deploy
Push para `main` dispara deploy automático:
```bash
git push origin main
```

Acompanhe em **Deployments** na Vercel.

---

## 8. CI no GitHub Actions

Já configurado em `.github/workflows/ci.yml`. Roda em todo push/PR:
- Lint (ESLint)
- Typecheck (tsc)
- Testes (Jest)
- Build (next build)

**Habilitar**: https://github.com/jkstore12/minha-ia/actions (botão "I understand my workflows..." se aparecer)

---

## 9. Pós-deploy checklist

- [ ] Testar signup em https://minha-ia-orquestrador.vercel.app/cadastro
- [ ] Verificar que o admin email (em `ADMIN_EMAILS`) consegue entrar
- [ ] Aprovar o próprio user (ou outro admin aprova)
- [ ] Testar chat com uma mensagem
- [ ] Verificar logs em https://vercel.com/jkstore12/minha-ia-orquestrador/logs
- [ ] Configurar cron da Vercel (já está no `vercel.json` para relatório diário WhatsApp)
- [ ] Configurar Supabase pg_cron para lembretes (após migrations)

---

## 10. Troubleshooting

### "Supabase nao configurado"
Verifique que `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` estão setadas **e começam com `NEXT_PUBLIC_`** (necessário para expor no client).

### "IA nao configurada"
Verifique que `AI_API_KEY` (ou `OPENAI_API_KEY` / `OPENROUTER_API_KEY`) e `AI_MODEL` estão setadas.

### "Webhook nao autorizado" (Telegram)
`TELEGRAM_WEBHOOK_SECRET` no `.env.local` e no registro do webhook devem bater exatamente.

### "Webhook WhatsApp retornando 503"
`WHATSAPP_WEBHOOK_SECRET` nao esta configurado no Vercel. Defina a env var e garanta que o reverse proxy ou a Evolution API envia `x-webhook-secret: <valor>` na requisicao.

### "Webhook WhatsApp retornando 401"
O secret esta configurado mas o header `x-webhook-secret` (ou query `?secret=`) nao esta batendo. Verifique que o reverse proxy injeta o header antes do request chegar ao Vercel e que o valor e exatamente o mesmo.

### "Anexo rejeitado com erro 415"
O `/api/attachments` agora faz magic-byte sniffing. Se o cliente declara `image/jpeg` mas os bytes sao de outro formato (ex.: PDF, EXE renomeado), o upload e rejeitado. Verifique que o arquivo e realmente do tipo declarado, ou ajuste o `ALLOWED_ATTACHMENT_MIMES` em `src/lib/chat/attachments.ts` para o seu caso.

### "Deep health check pula o probe de IA"
O `/api/health?deep=1` so faz `Authorization: Bearer <AI_API_KEY>` para hosts em allow-list (api.openai.com, openrouter.ai, etc). Se voce usa um provedor custom, adicione o host em `ALLOWED_AI_PROBE_HOSTS` em `src/app/api/health/route.ts`.

### "Muitas mensagens em pouco tempo"
Rate limit atingido. Ajuste `CHAT_RATE_LIMIT_PER_MIN` e `CHAT_RATE_LIMIT_PER_DAY` no `.env.local`.

### "Permission denied" no Storage
A migration `0005_message_attachments_storage.sql` deve ter sido aplicada. Verifique no SQL Editor: `SELECT * FROM storage.objects LIMIT 1;`

### RAG nao funciona
1. Verifique que a migration `20260702_agent_knowledge_embeddings.sql` foi aplicada
2. Verifique que pgvector está habilitado: `CREATE EXTENSION IF NOT EXISTS vector;` no SQL Editor
3. Adicione uma knowledge base via UI e veja se gera embedding (sem erro no console)

---

## Links úteis

- Repositório: https://github.com/jkstore12/minha-ia
- Vercel: https://vercel.com/jkstore12/minha-ia-orquestrador
- Supabase: https://supabase.com/dashboard
- OpenRouter: https://openrouter.ai
- Upstash: https://upstash.com
- Evolution API: https://github.com/EvolutionAPI/evolution-api
