import { NextResponse } from "next/server";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/chat/attachments";
import { hasSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  if (!hasSupabaseEnv()) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  }

  const { data: attachment, error } = await supabase
    .from("message_attachments")
    .select("storage_path, file_name, mime_type")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !attachment) {
    return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  }

  const { data, error: downloadError } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .download(attachment.storage_path);

  if (downloadError || !data) {
    return NextResponse.json({ error: "Não foi possível baixar o arquivo." }, { status: 404 });
  }

  return new Response(data, {
    headers: {
      "Content-Type": attachment.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.file_name)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
