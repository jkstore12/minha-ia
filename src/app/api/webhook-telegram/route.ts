import { adaptVercelHandler } from "@/lib/api/webhook-adapter";
// .js sem declarations; o handler tem shape (req, res) e adaptVercelHandler
// provê os tipos. Sem @ts-expect-error porque o import funciona: o tipo
// inferido de `telegramHandler` e any, que e aceitavel.
import telegramHandler from "@/lib/webhooks/telegram";

/**
 * Telegram webhook receiver.
 *
 * Migrated from Vercel serverless function (api/webhook-telegram.js) to
 * Next.js App Router. A logica permanece no shape Vercel (req, res)
 * porque o handler tem dependencias no globalThis (dedupe de updates,
 * session state, etc) que funcionam melhor com o escopo da funcao.
 *
 * Fail-closed: sem TELEGRAM_WEBHOOK_SECRET configurado, retorna 503.
 * Header esperado: x-telegram-bot-api-secret-token (injetado pelo
 * Telegram quando o webhook e registrado com secret_token).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro/Enterprise permite ate 300s; mantemos 60s como default.
export const maxDuration = 60;

export const GET = adaptVercelHandler(telegramHandler);
export const POST = adaptVercelHandler(telegramHandler);