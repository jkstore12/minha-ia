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
