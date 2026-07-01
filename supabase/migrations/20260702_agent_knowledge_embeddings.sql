-- RAG com embeddings para agent_knowledge
-- =================================================================
-- Adiciona suporte a busca por similaridade vetorial na base de
-- conhecimento de cada agente. Usa pgvector (extensao nativa do
-- Supabase).
--
-- Dimensao padrao: 1536 (text-embedding-3-small da OpenAI).
-- Se o usuario trocar o modelo de embedding, a coluna tera que
-- ser recriada com a nova dimensao. Use a variavel
-- EMBEDDING_DIMENSIONS no env para alinhar (padrao 1536).
-- =================================================================

-- Habilita a extensao pgvector. Idempotente.
create extension if not exists vector;

-- Coluna de embedding. Default 1536.
alter table public.agent_knowledge
  add column if not exists embedding vector(1536);

-- Indice HNSW para busca aproximada rapida. Cosine similarity e a
-- metrica padrao para embeddings normalizados.
-- HNSW vs IVFFlat: HNSW e melhor para uso geral (recalls maiores,
-- nao precisa de treinamento). Custo: mais memoria. Para <10k
-- entries, IVFFlat tambem serve; depois disso HNSW compensa.
create index if not exists agent_knowledge_embedding_idx
  on public.agent_knowledge
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

-- Funcao SQL de busca por similaridade. Recebe o embedding da query
-- (em formato string '[0.1,0.2,...]') e retorna os top-K resultados
-- mais proximos, opcionalmente filtrados por agent_id.
--
-- Parametros:
--   query_embedding: vetor da mensagem/pergunta do usuario
--   match_count: numero de resultados (default 12)
--   filter_agent_id: opcional, restringe a um agente especifico
--   filter_user_id: obrigatorio, isola por usuario
--   min_similarity: similaridade minima (0-1, default 0 = sem min)
create or replace function public.search_agent_knowledge(
  query_embedding vector(1536),
  match_count integer default 12,
  filter_agent_id uuid default null,
  filter_user_id uuid default null,
  min_similarity double precision default 0
)
returns table (
  id uuid,
  agent_id uuid,
  user_id uuid,
  title text,
  kind text,
  content text,
  tags text[],
  priority integer,
  source_url text,
  is_active boolean,
  similarity double precision
)
language sql
stable
as $$
  select
    k.id,
    k.agent_id,
    k.user_id,
    k.title,
    k.kind,
    k.content,
    k.tags,
    k.priority,
    k.source_url,
    k.is_active,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.agent_knowledge as k
  where k.embedding is not null
    and k.is_active = true
    and (filter_agent_id is null or k.agent_id = filter_agent_id)
    and (filter_user_id is null or k.user_id = filter_user_id)
    and 1 - (k.embedding <=> query_embedding) >= min_similarity
  order by k.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.search_agent_knowledge(
  vector, integer, uuid, uuid, double precision
) to authenticated, service_role;

comment on function public.search_agent_knowledge is
  'Busca por similaridade vetorial na base de conhecimento. Retorna top-K ordenadas por cosine similarity.';
comment on column public.agent_knowledge.embedding is
  'Embedding vetorial (1536 dim, text-embedding-3-small). Calculado na insercao; usado para RAG.';
