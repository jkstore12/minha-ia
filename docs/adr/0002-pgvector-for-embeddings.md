# ADR-0002: pgvector (Postgres) para embeddings e RAG

- **Status**: Aceito
- **Data**: 2026-07
- **Decisor**: @jkstore12

## Contexto

O sistema tem um RAG (Retrieval-Augmented Generation) onde cada agente tem uma knowledge base de texto. O chat busca top-K documentos similares ao user message para passar como contexto para o LLM.

Opcoes de vector store:
- **Pinecone**: SaaS dedicado. Custo mensal significativo, latencia baixa, escala horizontal.
- **Weaviate**: Open-source, requer infra propria (Docker / Kubernetes).
- **Qdrant**: Open-source, similar ao Weaviate.
- **pgvector** (extensao do Postgres): Reutiliza o banco existente, zero infra adicional, latencia levemente maior.

Requisitos:
- Multi-tenancy por `user_id` + `agent_id` (RLS).
- ~10k-100k embeddings por usuario (escala pessoal/profissional).
- Latencia aceitavel (<200ms para top-K=10).
- Custo operacional proximo de zero.

## Decisao

Usamos **pgvector** no mesmo Postgres que ja hospeda os dados do app. Embeddings gerados via OpenAI `text-embedding-3-small` (1536 dim).

## Consequencias

### Positivas
- Zero infra adicional alem do Supabase ja configurado.
- RLS aplicado nativamente — `agent_knowledge` herda o `user_id` filter.
- Transacoes atomicas: embedding insert + document insert no mesmo `BEGIN/COMMIT`.
- Sem vendor lock-in alem do Supabase (que ja usamos).
- Custo: `$0` alem da subscription Supabase existente.

### Negativas
- Performance de `ivfflat`/`hnsw` indices degrada acima de ~1M rows por tabela. Hoje nao chegamos perto (10k-100k por usuario e RLS particiona).
- Backup do banco fica maior (1.5KB por embedding x 100k = 150MB por usuario).
- Sem sharding nativo. Se chegarmos a 10M embeddings totais, precisamos re-arquitetar.

### Quando reverter
- Atingir > 1M embeddings em uma unica tabela.
- Latencia de busca subir acima de 500ms (investigar index, depois considerar Pinecone).
- Necessidade de multi-region (pgvector nao replica bem cross-region).

## Referencias

- [pgvector docs](https://github.com/pgvector/pgvector)
- Migration: `supabase/migrations/20260702_agent_knowledge_embeddings.sql`
- Implementacao: `src/lib/ai/embeddings.ts`
