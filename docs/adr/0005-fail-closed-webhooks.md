# ADR-0005: Fail-closed para webhooks e cron (zero tolerancia a misconfig)

- **Status**: Aceito
- **Data**: 2026-07
- **Decisor**: @jkstore12

## Contexto

Endpoints publicos (Telegram, WhatsApp, cron) sao faceis de deixar expostos por misconfiguracao. Um operador pode:
- Esquecer de setar `TELEGRAM_WEBHOOK_SECRET`.
- Apagar a env var por engano.
- Configurar o webhook do Telegram mas esquecer o secret no `.env`.

Cenarios de risco:
- Telegram/WhatsApp webhook aberto = qualquer pessoa com a URL sintetiza mensagens, faz o agente executar owner commands, queima tokens.
- Cron aberto = qualquer pessoa com a URL chama `/api/cron/reminders` ou `/api/whatsapp/personal/reports`, podendo disparar lembretes spam ou ler relatorios privados.

Politicas possiveis:
- **Fail-open (default)**: secret nao configurada = endpoint atende. Erro silencioso.
- **Fail-closed (estrito)**: secret nao configurada = endpoint retorna 503. Operador forc ado a configurar antes de expor.

## Decisao

Adotamos **fail-closed** em todos os endpoints publicos:

- `/api/webhook-telegram` e `/api/webhook-whatsapp`: sem `*_WEBHOOK_SECRET` setada, retornam 503.
- `/api/cron/reminders` e `/api/whatsapp/personal/reports`: sem `CRON_SECRET` setada, retornam 401.
- Comparacao via `crypto.timingSafeEqual` para evitar timing attacks.

Implementacao em:
- `src/lib/cron-auth.ts` — `isCronAuthorized`.
- `api/webhook-telegram.js` — inline check no handler.
- `api/webhook-whatsapp.js` — `isWhatsappWebhookAuthorized` inline.

## Consequencias

### Positivas
- **Default seguro**: deploy novo nao expoe endpoints sem o operador ter configurado explicitamente.
- **Visibilidade**: o operador recebe 503/401 no primeiro request, o que sinaliza misconfig imediatamente (em vez de servir requests com bugs).
- **Forc a a configurar**: nao ha caminho "esqueci de setar mas funciona" que vire incidente em producao.
- **Audit-friendly**: o estado de seguranca do deploy e deterministico.

### Negativas
- **Fricção no primeiro deploy**: operador tem que setar as secrets antes do endpoint funcionar. Mitigamos com mensagens de erro claras ("Configure CRON_SECRET e envie Authorization: Bearer <secret>").
- **Operadores que dependem do `fail-open` (ex: desenvolvimento local sem auth)**: precisam setar `CRON_SECRET=dev` no `.env.local` para testes. Documentado.
- **Custo de coordenacao**: se o operador rotaciona a secret, precisa atualizar o registro do webhook ao mesmo tempo. Mitigamos com a documentacao de rotation no `SECURITY.md`.

### Tradeoff explicito

Escolhemos **friccao de setup > risco de incidente**. A probabilidade de um operador esquecer a secret e servir requests sem auth e maior do que a probabilidade de ele ser bloqueado por uma config obrigatoria.

### Como funciona

```ts
// src/lib/cron-auth.ts
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // FAIL-CLOSED: sem secret, sem acesso.
  // timingSafeEqual check ...
}
```

E nos webhooks:

```js
// api/webhook-telegram.js (resumo)
const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!expectedSecret) {
  return res.status(503).json({ ok: false, error: "Webhook secret nao configurado." });
}
if (req.headers["x-telegram-bot-api-secret-token"] !== expectedSecret) {
  return res.status(401).json({ ok: false, error: "Webhook nao autorizado." });
}
```

## Quando reverter

Raramente. As razoes para fail-open seriam:
- Compatibilidade com integracoes legadas que nao suportam auth. **Mitigacao**: rejeitar e migrar a integracao.
- Ambiente de testes onde a secret e "inuteis". **Mitigacao**: usar `dev-secret` explicito.

## Referencias

- [SECURITY.md](../../SECURITY.md) — praticas de seguranca aplicadas
- Implementacao: `src/lib/cron-auth.ts`, `api/webhook-telegram.js`, `api/webhook-whatsapp.js`
- Testes: `src/lib/__tests__/cron-auth.test.ts`
