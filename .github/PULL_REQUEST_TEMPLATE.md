## Descricao

<!-- Resuma em 1-3 frases o que este PR faz e por que. -->

## Tipo de Mudanca

- [ ] Bug fix (non-breaking change que corrige um issue)
- [ ] Nova feature (non-breaking change que adiciona funcionalidade)
- [ ] Breaking change (fix ou feature que quebraria comportamento existente)
- [ ] Refactor (sem mudanca de comportamento)
- [ ] Documentacao
- [ ] Testes
- [ ] Build / CI
- [ ] Chore (manutencao)

## Issue Relacionada

<!-- Linka o issue: Fixes #123, Related to #456, ou "sem issue". -->

## Como Testar

<!-- Descreva os passos para validar o PR. Se ha testes adicionados, mencione. -->

```bash
npm run lint
npm run typecheck
npm test
```

## Checklist

### Codigo
- [ ] `npm run lint` passa
- [ ] `npm run typecheck` passa
- [ ] `npm test` passa
- [ ] Adicionei testes para mudancas de comportamento
- [ ] Cobertura de testes nao diminuiu

### Banco de Dados (se aplicavel)
- [ ] Migration nova em `supabase/migrations/YYYYMMDDHHMMSS_descricao.sql`
- [ ] Migration e idempotente (ou documentei por que nao e)
- [ ] Migration e **backward-compatible** (nao quebra deploy em rolling)
- [ ] Nenhuma migration existente foi editada
- [ ] Documentei impacto no schema no corpo do PR

### Env vars (se aplicavel)
- [ ] Adicionei a nova var em `.env.example` com comentario
- [ ] Parseei em `src/lib/env.ts` com tipo/default/validacao
- [ ] Documentei em `DEPLOY.md` na secao correspondente
- [ ] Nenhum secret com prefixo `NEXT_PUBLIC_` (server-only keys nao sao expostas no client)
- [ ] Nenhum secret novo commitado

### Seguranca (se aplicavel)
- [ ] Webhooks/cron: secrets via `crypto.timingSafeEqual`, fail-closed
- [ ] Upload: magic-byte sniffing nao foi regredido
- [ ] SSRF: DNS rebinding mitigation nao foi regredido
- [ ] Health: scrubbing de provider/model mantido em shallow mode
- [ ] PII redaction em logs nao foi regredido
- [ ] Nenhuma secret commitada (CI roda gitleaks; verificar `git diff` cuidadosamente)

### Observabilidade (se aplicavel)
- [ ] `x-request-id` em responses de API
- [ ] Logs estruturados em vez de `console.log`
- [ ] PII redaction aplicada em qualquer log novo
- [ ] Correlation id propagado em spans async (`after()`, callbacks)

### UI (se aplicavel)
- [ ] Textos em portugues do Brasil
- [ ] Nao introduz secoes em ingles no produto final
- [ ] Acessibilidade: aria-labels em elementos interativos novos

### Documentacao
- [ ] Atualizei [README.md](./README.md) se necessario
- [ ] Atualizei [DEPLOY.md](./DEPLOY.md) se a mudanca afeta deploy
- [ ] Atualizei [ARCHITECTURE.md](./ARCHITECTURE.md) se a mudanca afeta topologia
- [ ] Atualizei [CONTRIBUTING.md](./CONTRIBUTING.md) se mudei workflow de dev
- [ ] Adicionei ADR em `docs/adr/` para decisoes de longo prazo

## Screenshots (se aplicavel)

<!-- Para mudancas visuais, anexe screenshots ou GIFs. -->

## Notas para o Revisor

<!-- Riscos, decisoes nao-obvias, areas onde eu tenho duvida, pontos que merecem discussao. -->

## Rollback Plan

<!-- Como reverter este PR com seguranca se algo der errado em producao. -->
