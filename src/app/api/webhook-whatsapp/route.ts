import { adaptVercelHandler } from "@/lib/api/webhook-adapter";
// .js sem declarations; ver comentario em webhook-telegram/route.ts.
import whatsappHandler from "@/lib/webhooks/whatsapp";

/**
 * WhatsApp webhook receiver (Evolution API).
 *
 * Migrated from Vercel serverless function (api/webhook-whatsapp.js) to
 * Next.js App Router. Mesma logica Vercel-shape preservada.
 *
 * Fail-closed: sem WHATSAPP_WEBHOOK_SECRET configurado, retorna 503.
 * Header esperado: x-webhook-secret OU query param ?secret=<valor>.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = adaptVercelHandler(whatsappHandler);
export const POST = adaptVercelHandler(whatsappHandler);