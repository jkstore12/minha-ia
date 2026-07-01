import { NextResponse } from "next/server";
import {
  CHAT_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_BYTES,
  sanitizeFileName,
} from "@/lib/chat/attachments";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const fileName = sanitizeFileName(file.name);
  const storagePath = `${user.id}/${crypto.randomUUID()}-${fileName}`;
  const mimeType = file.type || "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .upload(storagePath, file, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
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
