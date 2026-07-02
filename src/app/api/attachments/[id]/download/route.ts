import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/chat/attachments";
import { hasSupabaseEnv } from "@/lib/env";
import { getApiContext, jsonError, withRequestIdOnResponse } from "@/lib/api/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { requestId } = getApiContext(request, "attachments-download");

  if (!hasSupabaseEnv()) {
    return jsonError("Supabase não configurado.", { status: 503, requestId, code: "supabase_not_configured" });
  }

  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Sessão expirada. Entre novamente.", { status: 401, requestId, code: "auth_expired" });
  }

  const { data: attachment, error } = await supabase
    .from("message_attachments")
    .select("storage_path, file_name, mime_type")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !attachment) {
    return jsonError("Arquivo não encontrado.", { status: 404, requestId, code: "not_found" });
  }

  const { data, error: downloadError } = await supabase.storage
    .from(CHAT_ATTACHMENTS_BUCKET)
    .download(attachment.storage_path);

  if (downloadError || !data) {
    return jsonError("Não foi possível baixar o arquivo.", { status: 404, requestId, code: "not_found" });
  }

  return withRequestIdOnResponse(
    new Response(data, {
      headers: {
        "Content-Type": attachment.mime_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.file_name)}"`,
        // private, no-store: arquivos do usuario podem conter PII.
        // Nenhum proxy/CDN deve cachear.
        "Cache-Control": "private, no-store",
      },
    }),
    requestId,
  );
}