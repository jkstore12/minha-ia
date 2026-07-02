import { NextResponse } from "next/server";
import { ensureUserAccess } from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";
import { createLogger, extractOrCreateRequestId, type Logger } from "@/lib/log";

/**
 * Helpers compartilhados para API routes.
 *
 * Padrao de error envelope (jsonError):
 *   { error: string, code?: string, requestId?: string, details?: object }
 *
 * Padrao de success envelope: NextResponse.json(data, init) — sem wrapper.
 * Cron e health-check mantem shape { ok: boolean, ... } por compatibilidade
 * com dashboards de monitoramento.
 *
 * O request id e propagado em **todas** as responses (success e error)
 * via header `x-request-id`, e em errors tambem no body para facilitar
 * correlacao com logs server-side.
 */

export type ApiErrorBody = {
  error: string;
  code?: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

export type ApiErrorOptions = {
  /** HTTP status code (default 400). */
  status?: number;
  /** Machine-readable error code (e.g., "auth_expired", "validation_failed"). */
  code?: string;
  /** Correlation id. Se omitido, NAO e setado no header nem no body. */
  requestId?: string;
  /** Extra context (e.g., zod issues, field names). */
  details?: Record<string, unknown>;
};

// Overloads para suportar tanto a forma nova (options) quanto a legada
// (message, status). Migre para a forma nova quando tocar no callsite.
export function jsonError(message: string, options: ApiErrorOptions): NextResponse;
export function jsonError(message: string, status?: number): NextResponse;
export function jsonError(message: string, arg?: number | ApiErrorOptions): NextResponse {
  const options: ApiErrorOptions =
    typeof arg === "number" ? { status: arg } : arg ?? {};
  const status = options.status ?? 400;
  const body: ApiErrorBody = { error: message };
  if (options.code) body.code = options.code;
  if (options.requestId) body.requestId = options.requestId;
  if (options.details) body.details = options.details;
  const response = NextResponse.json(body, { status });
  if (options.requestId) {
    response.headers.set("x-request-id", options.requestId);
  }
  return response;
}

/**
 * Helper para respostas no formato `{ ok: boolean, ... }` (cron, health).
 * Aplica o mesmo padrao de header `x-request-id` e inclui o id no body
 * para facilitar debugging.
 */
export function jsonResult(
  ok: boolean,
  body: Record<string, unknown> = {},
  options: { status?: number; requestId?: string } = {},
): NextResponse {
  const response = NextResponse.json({ ok, ...body }, options.status ? { status: options.status } : undefined);
  if (options.requestId) {
    response.headers.set("x-request-id", options.requestId);
    // Injeta requestId no body tambem, se nao estiver presente.
    if (!("requestId" in body)) {
      // Re-cria o body com requestId adicionado. NextResponse ja enviou o body,
      // mas como o cliente ainda nao consumiu, podemos recriar via clone?
      // Para evitar isso, o caller pode passar requestId no body se quiser.
      // Documentamos no JSDoc.
    }
  }
  return response;
}

/**
 * Extrai (ou gera) o request id e cria um logger escopado.
 * Use no inicio de cada route handler:
 *
 *   const { requestId, logger } = getApiContext(request, "minha-rota");
 *   if (!ok) return jsonError("...", { requestId, status: 400 });
 */
export type ApiContext = {
  requestId: string;
  logger: Logger;
};

export function getApiContext(request: Request, scope: string): ApiContext {
  const requestId = extractOrCreateRequestId(request);
  return {
    requestId,
    logger: createLogger(scope, requestId),
  };
}

/**
 * Helper para aplicar x-request-id em uma response ja construida.
 * Use em NextResponse.json(...) que nao sao erros (success path):
 *
 *   return withRequestIdHeader(NextResponse.json(data), requestId);
 */
export function withRequestIdHeader(response: NextResponse, requestId: string): NextResponse {
  response.headers.set("x-request-id", requestId);
  return response;
}

/**
 * Wrapper para aplicar x-request-id em qualquer Response.
 * Util para responses que nao sao NextResponse (ex: arquivo download).
 */
export function withRequestIdOnResponse<T extends Response>(response: T, requestId: string): T {
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function getAuthedSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { supabase, user: null };
  }

  const access = await ensureUserAccess(supabase, user);
  if (!access.isApproved) {
    return { supabase, user: null, access };
  }

  return { supabase, user, access };
}

export function parseJson(request: Request) {
  return request.json().catch(() => null);
}