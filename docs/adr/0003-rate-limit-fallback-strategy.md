# ADR-0003: Rate limit in-memory com fallback opcional para Upstash

- **Status**: Aceito
- **Data**: 2026-07
- **Decisor**: @jkstore12

## Contexto

O endpoint `/api/chat` precisa de rate limit por usuario para evitar:
- Abuso de creditos de API (cada mensagem custa tokens).
- DDoS no banco (cada mensagem gera varias queries).
- Custo elevado em producao multi-instancia.

O comportamento esperado:
- 20 mensagens/min e 300 mensagens/dia por usuario (configuravel via env).
- Contador por usuario (nao global), porque a quota e por usuario.

Tradeoffs:
- **In-memory**: zero infra adicional, mas em Vercel serverless cada instancia tem seu proprio contador. Resultado: usuario pode conseguir ate `N_instancias * 20` mensagens/min no pior caso.
- **Upstash Redis**: distribuido, contadores compartilhados entre todas as instancias. Custo: ~$0 para uso pessoal, $10+/mes para uso profissional.

## Decisao

Implementamos rate limit **in-memory** por padrao, com fallback automatico para **Upstash Redis** se `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` estiverem setadas.

Implementacao em `src/lib/rate-limit.ts`:
- In-memory: `Map<key, { count, resetAt }>` com limpeza periodica.
- Upstash: `@upstash/ratelimit` com sliding window.
- Escolha feita em runtime, sem code change.

## Consequencias

### Positivas
- Zero config para rodar local ou deploy pessoal: funciona out-of-the-box.
- Upgrade path claro: setar 2 envs, sem deploy.
- Custo zero por padrao.
- Logica centralizada em uma funcao `consume(key, limit, windowMs)`.

### Negativas
- **Race condition leve em multi-instancia sem Upstash**: o usuario pode ter `N_instancias * 20` mensagens/min no pior caso. Para escala pessoal/profissional pequena, isso e aceitavel.
- Se o operador quiser enforcement estrito em prod, **precisa** setar Upstash. Documentado em `DEPLOY.md` e no `/api/health` (warning se Vercel multi-region detectado sem Upstash).

### Mitigacoes
- Headers `X-RateLimit-*` expostos em **todas** as responses (200 e 429), nao so nos erros. Cliente pode mostrar feedback.
- Limites por dia (300) sao mais estritos que por minuto (20). Mesmo com race, o limite diario e aproximado.
- Logica de "sliding window" no in-memory reduz variancia.

### Quando migrar para Upstash-only
- Multiplos `regions` na Vercel (cada regiao = instancia isolada).
- Custo de API crescendo exponencialmente (indicador que alguem esta abusando mesmo com rate limit).
- SLA contratual de 99.9% (in-memory pode perder contadores em cold start).

## Referencias

- [Upstash Ratelimit](https://upstash.com/docs/oss/sdks/ts/ratelimit/overview)
- Implementacao: `src/lib/rate-limit.ts`
- Testes: `src/lib/__tests__/rate-limit.test.ts`
