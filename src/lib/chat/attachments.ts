import { fileTypeFromBuffer } from "file-type";
import type { Attachment } from "@/lib/chat/types";

export const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 8;
export const MAX_AUDIO_RECORDING_MS = 5 * 60 * 1000;

export type PendingAttachment = Pick<Attachment, "storage_path" | "file_name" | "mime_type" | "size_bytes">;

export type PreparedAttachment = PendingAttachment & {
  dataUrl?: string;
  text?: string;
  transcription?: string;
  transcriptionModel?: string;
  transcriptionError?: string;
};

export function sanitizeFileName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "arquivo";
}

export function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function isImageMime(mimeType: string) {
  return mimeType.startsWith("image/");
}

export function isPdfMime(mimeType: string) {
  return mimeType === "application/pdf";
}

export function isAudioMime(mimeType: string, fileName = "") {
  return (
    mimeType.startsWith("audio/") ||
    /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm|ogg|oga)$/i.test(fileName)
  );
}

export function audioExtensionFromMime(mimeType: string) {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return "ogg";
  return "webm";
}

export function isTextLikeMime(mimeType: string, fileName: string) {
  const lowerName = fileName.toLowerCase();
  return (
    mimeType.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-javascript",
      "application/x-typescript",
      "application/yaml",
      "application/x-yaml",
      "application/csv",
    ].includes(mimeType) ||
    /\.(txt|md|markdown|csv|json|xml|html|css|js|jsx|ts|tsx|sql|log|yaml|yml)$/i.test(lowerName)
  );
}

export function attachmentDownloadUrl(id?: string) {
  return id ? `/api/attachments/${id}/download` : "";
}

// Allow-list de MIME types aceitos no upload. Tudo fora disso e rejeitado
// com 415 pelo /api/attachments. Texto nao tem magic bytes confiaveis,
// entao tipos text/* e application/{json,xml,csv,...} sao aceitos pelo
// claimed MIME apenas (sao inofensivos: contexto para o modelo).
export const ALLOWED_ATTACHMENT_MIMES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/x-m4a",
  "audio/aac",
  "audio/flac",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/x-markdown",
  "application/json",
  "application/xml",
  "application/csv",
];

export type SniffResult =
  | { ok: true; mime: string; ext: string; source: "sniffed" | "claimed-text" | "claimed-allowlist" }
  | { ok: false; reason: string; detectedMime?: string };

// fileTypeFromBuffer precisa de no minimo 4100 bytes para alguns
// formatos; mas funciona com buffers menores para a maioria. 4096 e um
// bom compromisso.
const SNIFF_BYTES = 4096;

export async function sniffAndValidateMime(
  file: { name: string; type: string; size: number; slice: (start: number, end: number) => Blob },
): Promise<SniffResult> {
  // Arquivo vazio: aceita apenas se claimed MIME for texto.
  if (file.size === 0) {
    const claimed = file.type || "application/octet-stream";
    if (ALLOWED_ATTACHMENT_MIMES.includes(claimed)) {
      return { ok: true, mime: claimed, ext: "", source: "claimed-allowlist" };
    }
    return { ok: false, reason: "Arquivo vazio sem tipo de texto permitido." };
  }

  const head = file.slice(0, Math.min(SNIFF_BYTES, file.size));
  const buffer = new Uint8Array(await head.arrayBuffer());
  const detected = await fileTypeFromBuffer(buffer);

  if (detected) {
    if (!ALLOWED_ATTACHMENT_MIMES.includes(detected.mime)) {
      return { ok: false, reason: `Tipo detectado (${detected.mime}) nao permitido.`, detectedMime: detected.mime };
    }
    return { ok: true, mime: detected.mime, ext: detected.ext, source: "sniffed" };
  }

  // Nao foi possivel detectar (texto puro, csv, json, etc). Confia
  // no claimed MIME se estiver no allow-list de texto. Se o cliente
  // mandou application/octet-stream sem sniffer, rejeita: muito
  // provavel binario malicioso.
  const claimed = file.type || "application/octet-stream";
  const isTexty = claimed.startsWith("text/") || [
    "application/json",
    "application/xml",
    "application/csv",
  ].includes(claimed);

  if (isTexty && ALLOWED_ATTACHMENT_MIMES.includes(claimed)) {
    return { ok: true, mime: claimed, ext: "", source: "claimed-text" };
  }

  return {
    ok: false,
    reason: claimed === "application/octet-stream"
      ? "Tipo nao reconhecido e cliente nao declarou um MIME confiavel."
      : `Tipo declarado (${claimed}) nao permitido e sem magic bytes correspondentes.`,
    detectedMime: claimed,
  };
}
