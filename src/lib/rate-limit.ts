/**
 * Rate limit com fallback in-memory.
 *
 * Em producao multi-instancia (Vercel serverless, Edge, clusters), a
 * implementacao in-memory nao funciona: cada instancia tera seu proprio
 * contador e o limite efetivo e multiplicado pelo numero de instancias.
 *
 * Para resolver isso, defina UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN
 * (crie um banco Upstash gratis em https://upstash.com). Quando setadas, o
 * modulo passa a usar @upstash/ratelimit, que funciona de forma distribuida.
 *
 * Sem as env vars, volta para o backend in-memory (util para dev local).
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** ms ate a janela liberar a proxima vaga */
  resetMs: number;
  /** limite configurado (ecoado para headers) */
  limit: number;
  /** qual backend esta em uso (util para observabilidade) */
  backend: "upstash" | "memory";
};

// =============================================================================
// Backend in-memory (fallback)
// =============================================================================

type Bucket = number[];

const memoryBuckets = new Map<string, Bucket>();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    for (const [key, bucket] of memoryBuckets) {
      if (bucket.length === 0) memoryBuckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof (cleanupTimer as { unref?: () => void }).unref === "function") {
    (cleanupTimer as { unref: () => void }).unref();
  }
}

ensureCleanup();

function consumeMemory(key: string, limit: number, windowMs: number): RateLimitResult {
  if (limit <= 0) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetMs: 0, limit, backend: "memory" };
  }

  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = memoryBuckets.get(key);
  if (!bucket) {
    bucket = [];
    memoryBuckets.set(key, bucket);
  }

  while (bucket.length > 0 && bucket[0] <= cutoff) {
    bucket.shift();
  }

  if (bucket.length >= limit) {
    const oldest = bucket[0];
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, oldest + windowMs - now),
      limit,
      backend: "memory",
    };
  }

  bucket.push(now);
  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.length),
    resetMs: windowMs,
    limit,
    backend: "memory",
  };
}

// =============================================================================
// Backend Upstash (para producao multi-instancia)
// =============================================================================

type UpstashLimiter = {
  limit: (key: string) => Promise<{ success: boolean; remaining: number; reset: number; limit: number }>;
};

let upstashLimiters: Map<string, UpstashLimiter> | null = null;

function getUpstashLimiters(): Map<string, UpstashLimiter> | null {
  if (upstashLimiters !== null) return upstashLimiters;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    upstashLimiters = null;
    return null;
  }

  const redis = new Redis({ url, token });
  // Cache por combinacao (limit, windowMs) para reaproveitar limiters
  upstashLimiters = new Map();
  // Cada chamada constroi o seu limiter (Upstash nao compartilha entre janelas
  // diferentes). Wrap em Map para reuso futuro.
  const createLimiter = (limit: number, windowMs: number): UpstashLimiter => {
    const prefix = `ratelimit:${limit}:${windowMs}`;
    // Converter windowMs para a string que @upstash/ratelimit aceita
    let window: `${number} ms` | `${number} s` | `${number} m` | `${number} h`;
    if (windowMs < 60_000) window = `${windowMs} ms`;
    else if (windowMs < 3_600_000) window = `${Math.round(windowMs / 1000)} s`;
    else window = `${Math.round(windowMs / 60_000)} m`;

    const rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window),
      prefix,
      analytics: false,
    });
    return { limit: (key: string) => rl.limit(key) };
  };
  upstashLimiters.set("__create__", { limit: async () => ({ success: true, remaining: 0, reset: 0, limit: 0 }) });
  (upstashLimiters as Map<string, unknown> & { __create?: typeof createLimiter }).set("__create__", createLimiter);
  return upstashLimiters;
}

async function consumeUpstash(key: string, limit: number, windowMs: number): Promise<RateLimitResult | null> {
  const limiters = getUpstashLimiters();
  if (!limiters) return null;

  const create = (limiters as unknown as { __create?: (l: number, w: number) => UpstashLimiter }).__create;
  if (!create) return null;

  // Cache por combinacao
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiters.get(cacheKey);
  if (!limiter) {
    limiter = create(limit, windowMs);
    limiters.set(cacheKey, limiter);
  }

  const result = await limiter.limit(key);
  // `reset` vem em ms (timestamp absoluto)
  const resetMs = Math.max(0, result.reset - Date.now());
  return {
    allowed: result.success,
    remaining: result.remaining,
    resetMs,
    limit: result.limit,
    backend: "upstash",
  };
}

// =============================================================================
// API publica
// =============================================================================

/**
 * Registra uma request e retorna se ela passou no limite.
 *
 * Auto-detecta o backend: usa Upstash se as env vars estiverem setadas,
 * senao cai para in-memory.
 *
 * @param key identificador unico (ex: `user:abc-123` ou `ip:1.2.3.4`)
 * @param limite maximo de requests na janela
 * @param windowMs tamanho da janela em ms
 */
export async function consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const upstashResult = await consumeUpstash(key, limit, windowMs);
  if (upstashResult) return upstashResult;
  return consumeMemory(key, limit, windowMs);
}

/**
 * Versao sincrona que sempre usa o backend in-memory. Util para tests e
 * para casos onde o caller precisa de uma resposta sincrona (mas a API
 * padrao e async e deve ser preferida).
 */
export function consumeSync(key: string, limit: number, windowMs: number): RateLimitResult {
  return consumeMemory(key, limit, windowMs);
}

/**
 * Para testes: limpa todos os contadores in-memory. Nao afeta Upstash.
 */
export function __resetForTests() {
  memoryBuckets.clear();
}

/**
 * Para testes: inspeciona o estado in-memory de uma chave.
 */
export function __peek(key: string): number {
  return memoryBuckets.get(key)?.length ?? 0;
}

/**
 * Para testes: reseta o cache de limiters do Upstash (forca re-criacao
 * ao proximo consume, util quando se mexe em env vars).
 */
export function __resetUpstashForTests() {
  upstashLimiters = null;
}
