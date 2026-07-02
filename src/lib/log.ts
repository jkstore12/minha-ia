/**
 * Logger estruturado com PII redaction.
 *
 * Fornece:
 *  - createLogger(scope): logger com info/warn/error/debug.
 *  - redactPII(input): substitui campos sensiveis por [REDACTED].
 *  - withRequestId(handler): wrapper para rotas API que extrai/gerar
 *    x-request-id e o devolve no response.
 *
 * Em producao (NODE_ENV=production) emite JSON estruturado em uma linha,
 * amigavel a Vercel logs / futuro Datadog/Sentry. Em dev, emite texto
 * colorido para facilitar leitura local.
 *
 * Nivel controlado por LOG_LEVEL (debug|info|warn|error). Default: info.
 */

const REDACTED = "[REDACTED]";

const PII_KEYS = new Set([
  "chat_id",
  "chatid",
  "message_id",
  "messageid",
  "message",
  "from",
  "text",
  "body",
  "phone",
  "phonenumber",
  "phone_number",
  "number",
  "remote_jid",
  "remotejid",
  "sender",
  "first_name",
  "last_name",
  "username",
  "raw_text",
  "caption",
  "content",
  "authorization",
  "cookie",
  "set-cookie",
]);

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getMinLevel(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;
  return LEVEL_ORDER[raw] ?? LEVEL_ORDER.info;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else if (typeof v === "string" && /^(Bearer |sk-|sk-or-|sk-ant-|xox[abps]-)/i.test(v)) {
      // Heuristica: tokens inline. NAO substitui a string inteira se for
      // algo que pareca texto natural; so quando bate com prefixos comuns
      // de chave.
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v);
    }
  }
  return out;
}

export function redactPII<T = unknown>(input: T): T {
  return redactValue(input) as T;
}

export type LogMetadata = Record<string, unknown>;

export interface Logger {
  debug(message: string, metadata?: LogMetadata): void;
  info(message: string, metadata?: LogMetadata): void;
  warn(message: string, metadata?: LogMetadata): void;
  error(message: string, metadata?: LogMetadata): void;
  child(extra: LogMetadata): Logger;
}

function emit(
  level: Level,
  scope: string,
  message: string,
  metadata: LogMetadata | undefined,
  requestId: string | undefined,
): void {
  if (LEVEL_ORDER[level] < getMinLevel()) return;

  const safeMeta = metadata ? redactPII(metadata) : {};
  const ts = new Date().toISOString();

  if (isProduction()) {
    const line = JSON.stringify({
      ts,
      level,
      scope,
      request_id: requestId,
      msg: message,
      ...(Object.keys(safeMeta).length ? { meta: safeMeta } : {}),
    });
    process.stdout.write(`${line}\n`);
    return;
  }

  const color = level === "error" ? COLORS.red : level === "warn" ? COLORS.yellow : COLORS.blue;
  const scopeLabel = `${COLORS.cyan}${scope}${COLORS.reset}`;
  const metaStr = Object.keys(safeMeta).length ? ` ${COLORS.dim}${JSON.stringify(safeMeta)}${COLORS.reset}` : "";
  const requestLabel = requestId ? `${COLORS.dim}[${requestId}]${COLORS.reset} ` : "";
  console.log(`${color}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${scopeLabel} ${requestLabel}${message}${metaStr}`);
}

export function createLogger(scope: string, requestId?: string): Logger {
  const build = (rid: string | undefined): Logger => {
    const logger: Logger = {
      debug: (msg, meta) => emit("debug", scope, msg, meta, rid),
      info: (msg, meta) => emit("info", scope, msg, meta, rid),
      warn: (msg, meta) => emit("warn", scope, msg, meta, rid),
      error: (msg, meta) => emit("error", scope, msg, meta, rid),
      child: (extra) => {
        emit("debug", scope, "child-created", extra, rid);
        return createLogger(scope, rid);
      },
    };
    return logger;
  };
  return build(requestId);
}

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{1,128}$/;

export function extractOrCreateRequestId(request: Request): string {
  const fromHeader = request.headers.get(REQUEST_ID_HEADER);
  if (fromHeader && REQUEST_ID_REGEX.test(fromHeader)) return fromHeader;
  // crypto.randomUUID() requires Node 14.17+/browser modern; available on Vercel.
  return globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function withRequestId(scope: string, handler: (request: Request, requestId: string) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const requestId = extractOrCreateRequestId(request);
    const logger = createLogger(scope, requestId);
    const startedAt = Date.now();

    logger.info("request.received", {
      method: request.method,
      url: request.url,
    });

    try {
      const response = await handler(request, requestId);
      const durationMs = Date.now() - startedAt;
      response.headers.set(REQUEST_ID_HEADER, requestId);
      logger.info("request.completed", {
        method: request.method,
        url: request.url,
        status: response.status,
        durationMs,
      });
      return response;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.error("request.failed", {
        method: request.method,
        url: request.url,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Re-throw: deixa o Next.js gerar a response 500 padrao, mas com
      // o request id injetado via headers de erro abaixo.
      throw error;
    }
  };
}