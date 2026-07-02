import { adaptVercelHandler } from "@/lib/api/webhook-adapter";
// .js sem declarations; ver comentario em webhook-telegram/route.ts.
import qrcodeHandler from "@/lib/webhooks/qrcode";

/**
 * WhatsApp QR code page (HTML).
 *
 * Migrated from Vercel serverless function (api/whatsapp-qrcode.js) to
 * Next.js App Router. Devolve uma pagina HTML com o QR code gerado pela
 * Evolution API para pareamento.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = adaptVercelHandler(qrcodeHandler);