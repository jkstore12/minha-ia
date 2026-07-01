/**
 * Embeddings e busca por similaridade para RAG.
 *
 * A embeddings API e a mesma em OpenAI e OpenRouter (mesma rota
 * `/v1/embeddings`), entao reaproveitamos o client OpenAI criado
 * em brain.ts (mas sem dependencia circular, criamos o nosso).
 *
 * O modelo padrao e `text-embedding-3-small` (1536 dim, ~$0.02/1M
 * tokens). Override via env EMBEDDING_MODEL.
 */

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, requireAiEnv } from "@/lib/env";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

let cachedClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const ai = requireAiEnv();
  const defaultHeaders: Record<string, string> = {};
  if (ai.provider === "openrouter") {
    defaultHeaders["HTTP-Referer"] = env.appUrl;
    defaultHeaders["X-Title"] = env.appName;
  }
  cachedClient = new OpenAI({
    apiKey: ai.apiKey,
    baseURL: ai.baseUrl,
    defaultHeaders,
  });
  return cachedClient;
}

function getEmbeddingModel(): string {
  return process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

/**
 * Gera o embedding de um texto. Retorna um vetor de numeros.
 * Lanca erro se a API retornar resposta vazia ou status != 200.
 */
export async function embedText(text: string): Promise<number[]> {
  if (!text.trim()) {
    throw new Error("embedText: texto vazio");
  }

  const client = getClient();
  const model = getEmbeddingModel();

  const response = await client.embeddings.create({
    model,
    input: text.slice(0, 32_000), // limite保守 (a API da OpenAI aceita ate ~8k tokens; 32k chars e folgado)
  });

  const vector = response.data[0]?.embedding;
  if (!vector || vector.length === 0) {
    throw new Error("embedText: resposta da API nao contem embedding");
  }
  return vector;
}

/**
 * Formata um vetor de numeros no formato string que o pgvector aceita
 * como parametro de funcao RPC: '[0.1,0.2,...]'.
 */
export function formatEmbeddingForRpc(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Resultado de uma busca por similaridade.
 */
export type KnowledgeSearchResult = {
  id: string;
  agent_id: string;
  user_id: string;
  title: string;
  kind: string;
  content: string;
  tags: string[] | null;
  priority: number;
  source_url: string | null;
  is_active: boolean;
  similarity: number;
};

export type SearchOptions = {
  /** Embedding da query (ja calculado) */
  queryEmbedding: number[];
  /** Quantos resultados trazer (default 12) */
  matchCount?: number;
  /** Restringir a um agente especifico */
  agentId?: string;
  /** User ID (obrigatorio para isolar dados) */
  userId: string;
  /** Similaridade minima 0-1 (default 0, sem filtro) */
  minSimilarity?: number;
};

/**
 * Tipo minimo do cliente Supabase que `searchAgentKnowledge` precisa.
 * Aceita o SupabaseClient real (rpc retorna PostgrestFilterBuilder,
 * que e thenable) ou mocks parciais em testes.
 */
export type SupabaseRpcClient = Pick<SupabaseClient, "rpc"> | {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Busca entradas de conhecimento por similaridade vetorial.
 * Wrapper sobre a funcao SQL `public.search_agent_knowledge`.
 */
export async function searchAgentKnowledge(
  supabase: SupabaseRpcClient,
  options: SearchOptions,
): Promise<KnowledgeSearchResult[]> {
  const { queryEmbedding, matchCount = 12, agentId, userId, minSimilarity = 0 } = options;

  const { data, error } = await supabase.rpc("search_agent_knowledge", {
    query_embedding: formatEmbeddingForRpc(queryEmbedding),
    match_count: matchCount,
    filter_agent_id: agentId ?? null,
    filter_user_id: userId,
    min_similarity: minSimilarity,
  });

  if (error) {
    throw new Error(`searchAgentKnowledge: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Para testes: limpa o cache do client OpenAI.
 */
export function __resetClientForTests() {
  cachedClient = null;
}
