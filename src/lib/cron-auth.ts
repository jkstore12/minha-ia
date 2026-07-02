import { timingSafeEqual } from "node:crypto";

/**
 * Autorizacao para endpoints de cron (Vercel Cron, schedulers externos).
 *
 * Politica: fail-closed. Se CRON_SECRET nao esta setado no ambiente,
 * o helper retorna false. Isso forc a o operador a configurar a
 * variavel antes de expor o endpoint em producao.
 *
 * Comparacao via crypto.timingSafeEqual para evitar timing attacks.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);

  // timingSafeEqual exige mesmo comprimento; em caso diferente, ainda
  // executamos uma comparacao dummy para manter tempo constante.
  if (a.length !== b.length) {
    // Faz uma comparacao dummy contra b para igualar tempo.
    timingSafeEqual(b, b);
    return false;
  }

  return timingSafeEqual(a, b);
}