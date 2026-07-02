import { NextResponse } from "next/server";
import {
  CHAT_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  sanitizeFileName,
  sniffAndValidateMime,
} from "@/lib/chat/attachments";
import { hasSupabaseEnv } from "@/lib/env";
import { getApiContext, jsonError, withRequestIdHeader } from "@/lib/api/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { requestId, logger } = getApiContext(request, "attachments-upload");
  if (!hasSupabaseEnv()) {
    return jsonError("Supabase não configurado.", { status: 503, requestId, code: "supabase_not_configured" });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Sessão expirada. Entre novamente.", { status: 401, requestId, code: "auth_expired" });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return jsonError("Envie um arquivo valido.", { status: 400, requestId, code: "validation_failed" });
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return jsonError("Arquivo grande demais. Limite: 25 MB por arquivo.", {
      status: 413,
      requestId,
      code: "file_too_large",
      details: { maxBytes: MAX_ATTACHMENT_BYTES, receivedBytes: file.size },
    });
  }

  // Magic-byte sniffing para evitar que um `.exe` renomeado para `.jpg`
  // seja armazenado e servido como image/jpeg. Se o cliente declara
  // image/jpeg mas os magic bytes sao de PDF, usamos o detectado.
  const sniff = await sniffAndValidateMime({
    name: file.name,
    type: file.type,
    size: file.size,
    slice: (start, end) => file.slice(start, end),
  });

  if (!sniff.ok) {
    logger.warn("attachment.rejected", {
      userId: user.id,
      fileName: file.name,
      declaredType: file.type,
      sizeBytes: file.size,
      reason: sniff.reason,
      detectedMime: sniff.detectedMime,
    });
    return jsonError("Tipo de arquivo nao permitido.", {
      status: 415,
      requestId,
      code: "unsupported_media_type",
      details: {
        reason: sniff.reason,
        ...(sniff.detectedMime ? { detectedMime: sniff.detectedMime } : {}),
      },
    });
  }

  const fileName = sanitizeFileName(file.name);
  const storagePath = `${user.id}/${crypto.randomUUID()}-${fileName}`;
  const mimeType = sniff.mime;

  const { error: uploadError } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    logger.error("attachment.upload.failed", {
      userId: user.id,
      fileName,
      mimeType,
      sizeBytes: file.size,
      supabaseError: uploadError.message,
    });
    return jsonError("Não foi possível enviar o arquivo. Confira se o setup do Supabase Storage foi aplicado.", {
      status: 500,
      requestId,
      code: "upload_failed",
    });
  }

  return withRequestIdHeader(
    NextResponse.json({
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: file.size,
    }),
    requestId,
  );
}
