# Politica de Seguranca

## Reportando uma Vulnerabilidade

Se voce descobriu uma vulnerabilidade de seguranca no **Minha IA**, **NAO abra issue publica**. Entre em contato por um dos canais abaixo:

- **Email**: abra um Security Advisory no GitHub em https://github.com/jkstore12/minha-ia/security/advisories/new
- **Tempo de resposta**: ate 7 dias uteis para triagem inicial.

Por favor inclua:

1. Descricao do problema e impacto potencial.
2. Passos para reproduzir (proof of concept).
3. Versao/commit afetado.
4. Sua coordenacao de contato para follow-up (opcional, mas ajuda).

## O que esperar

1. **Confirmacao** do recebimento em ate 7 dias.
2. **Triagem** em ate 14 dias — confirmamos se e vuln valida e qual a severidade.
3. **Patch** dependendo da severidade:
   - **Critica** (RCE, auth bypass, data leak): patch em ate 30 dias.
   - **Alta** (XSS stored, privilege escalation): patch em ate 60 dias.
   - **Media/Baixa**: agendado com a proxima release.
4. **Coordinated disclosure**: pedimos para nao divulgar publicamente ate termos um patch e um advisory publicado. Prazo maximo de 90 dias a partir do report.

## Versoes Suportadas

| Versao | Suportada |
|---|---|
| `main` (latest) | ✓ |
| Commits ate 30 dias | ✓ |
| Mais antigos | ✗ (faça upgrade) |

Este projeto segue SemVer a partir de 1.0.0. Antes disso, qualquer breaking change pode aparecer entre minor versions.

## Hall of Fame

Agradecemos aos pesquisadores que reportaram vulnerabilidades de forma coordenada (lista em construcao).

## Praticas de Seguranca Aplicadas

Esta secao documenta as decisoes de seguranca que ja estao em producao, para referencia de auditores e contribuidores.

### Auth & Authz
- Supabase Auth com RLS por `user_id`.
- Service role usada apenas em server-side (rotas API, webhooks, cron).
- Admin approval flow: `approval_status = "pending"` ate aprovacao manual.

### Webhooks (Telegram, WhatsApp)
- **Fail-closed**: `TELEGRAM_WEBHOOK_SECRET` / `WHATSAPP_WEBHOOK_SECRET` devem estar configurados OU o endpoint retorna 503.
- Comparacao via `crypto.timingSafeEqual`.
- WhatsApp aceita o secret via header `x-webhook-secret` ou query `?secret=` (configure seu reverse proxy de acordo).

### Cron
- `CRON_SECRET` obrigatorio em producao. Sem ele, `/api/cron/*` retorna 401.
- Comparacao via `crypto.timingSafeEqual` com length-mismatch guard.

### Upload de Anexos
- Magic-byte sniffing com `file-type`. `.exe` renomeado para `.jpg` e rejeitado com 415.
- `ALLOWED_ATTACHMENT_MIMES` allow-list em `src/lib/chat/attachments.ts`.
- Bucket `chat-attachments` privado com RLS.

### SSRF (readUrl)
- Hostname blocklist + DNS resolution check via `isBlockedAddress` (BlockList com RFC1918, loopback, ULA, link-local).
- Default-deny para enderecos nao classificados.

### Health Endpoint
- `/api/health` (publico) nao expoe `provider`, `model`, ou `baseUrl` em modo shallow.
- `/api/health?deep=1` faz probes reais mas gated por `ALLOWED_AI_PROBE_HOSTS` para nao vazar `AI_API_KEY` para hosts nao-confiaveis.

### Logging & PII
- Logger estruturado com PII redaction (`src/lib/log.ts`).
- Substituiu `console.error` nos webhooks.
- `Cache-Control: private, no-store` em downloads de anexos.

### Rate Limiting
- 20 mensagens/min e 300 mensagens/dia por usuario (configuravel).
- In-memory por padrao, Upstash Redis em prod multi-instancia.
- Rate limit NAO consome slot em caso de auth fail (pre-abuse protection).

## Variaveis de Ambiente Sensíveis

Variaveis que **nunca** devem ser commitadas ou expostas no client:

- `SUPABASE_SERVICE_ROLE_KEY` — bypassa RLS. Server-only.
- `AI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` — chaves de provedor.
- `TELEGRAM_BOT_TOKEN`, `WHATSAPP_INSTANCE_NAME` (com token associado) — credenciais de bot.
- `EVOLUTION_API_KEY` — chave da Evolution API.
- `UPSTASH_REDIS_REST_TOKEN` — token Redis.
- `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_WEBHOOK_SECRET` — secrets de auth.

Todas com prefixo `NEXT_PUBLIC_` sao embutidas no bundle do client e **publicas**. Use `NEXT_PUBLIC_` apenas para valores que o browser precisa ver (URL do Supabase, anon key, etc).

## Scope

Em scope:
- `src/` — codigo do app Next.js.
- `api/` — Vercel serverless functions.
- `supabase/migrations/` — migrations do banco.
- `scripts/` — scripts de setup.
- Documentacao que induz usuarios a configuracao insegura (ex: `.env.example` com secrets placeholder).

Fora de scope:
- Dependencias de terceiros (Supabase, OpenRouter, Evolution API, Vercel). Reporte para os respectivos mantenedores.
- Configuracao especifica de runtime de cada operador. Se voce descobriu que um operador nosso esta mal-configurado, reporte tambem — investigamos.
- Ataques de engenharia social contra o owner do deploy.

## Boas Praticas para Operadores

1. **Rotacione secrets periodicamente.** Especialmente `CRON_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_WEBHOOK_SECRET`.
2. **Use HTTPS em todos os endpoints publicos.** Vercel ja faz isso, mas se voce usar reverse proxy, garanta TLS 1.2+.
3. **Restrinja CORS.** O app nao expoe CORS para origens externas; se voce adicionar, revise.
4. **Monitore `/api/health?deep=1`.** Configure um monitor externo (UptimeRobot, Better Stack) que alerta em status != 200.
5. **Habilite Supabase audit logs** se seu plano suportar.
6. **Revise os logs do Vercel** periodicamente. Procure por `webhook.unauthorized` e `attachment.rejected` — indicam tentativas de abuso.

## Agradecimentos

Agradecemos a todos que reportam vulnerabilidades de forma etica.
