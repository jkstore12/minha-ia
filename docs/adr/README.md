# Architecture Decision Records (ADRs)

Este diretorio contem decisoes de arquitetura de longo prazo documentadas em formato ADR. Cada ADR e imutavel apos ser mergeado; mudancas de decisao geram um novo ADR que substitui ou complementa o anterior.

## Formato

Cada ADR segue a estrutura:

- **Titulo**: `NNNN-titulo-curto.md`
- **Status**: Proposto / Aceito / Substituido por ADR-XXXX / Deprecado
- **Contexto**: qual problema estamos resolvendo, quais alternativas foram consideradas
- **Decisao**: o que escolhemos
- **Consequencias**: positivas, negativas, riscos, quando reverter
- **Referencias**: links relevantes

## Indice

| ADR | Titulo | Status |
|---|---|---|
| [0001](0001-nextjs-16-react-19.md) | Next.js 16 + React 19 como framework | Aceito |
| [0002](0002-pgvector-for-embeddings.md) | pgvector (Postgres) para embeddings e RAG | Aceito |
| [0003](0003-rate-limit-fallback-strategy.md) | Rate limit in-memory com fallback para Upstash | Aceito |
| [0004](0004-evolution-api-for-whatsapp.md) | Evolution API para WhatsApp pessoal | Aceito |
| [0005](0005-fail-closed-webhooks.md) | Fail-closed para webhooks e cron | Aceito |

## Quando criar um ADR

- Decisao que afeta mais de um componente ou area.
- Decisao que limita opcoes futuras (ex: vendor lock-in, breaking change de API).
- Decisao que voce espera revisar em 6-12 meses.
- Decisao que outros contribuidores vao questionar (precisamos de contexto para defender).

## Quando NAO criar um ADR

- Implementacao trivial sem tradeoffs.
- Decisao local a um modulo (ex: qual lib de UUID usar).
- Decisao que pode ser revertida sem consequencia (ex: otimizacao de performance).
