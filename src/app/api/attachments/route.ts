import { NextResponse } from "next/server";
import {
  CHAT_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  sanitizeFileName,
  sniffAndValidateMime,
} from "@/lib/chat/attachments";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const logger = createLogger("attachments-upload");
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo valido." }, { status: 400 });
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "Arquivo grande demais. Limite: 25 MB por arquivo." }, { status: 413 });
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
    return NextResponse.json(
      {
        error: "Tipo de arquivo nao permitido.",
        reason: sniff.reason,
        ...(sniff.detectedMime ? { detectedMime: sniff.detectedMime } : {}),
      },
      { status: 415 },
    );
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
    return NextResponse.json(
      { error: "Não foi possível enviar o arquivo. Confira se o setup do Supabase Storage foi aplicado." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    storage_path: storagePath,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: file.size,
  });
}
