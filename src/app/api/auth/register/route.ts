import { z } from "zod";
import { getApiContext, jsonError, jsonResult, parseJson } from "@/lib/api/server";
import { getSupabaseAdminClient, hasSupabaseServiceRole } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const RegisterInput = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().email("Informe um e-mail válido.").max(254),
  password: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres.").max(128),
});

async function upsertPendingProfile(input: { userId: string; name: string }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role não configurada.");

  const response = await fetch(`${url}/rest/v1/user_profiles?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: input.userId,
      display_name: input.name,
      role: "user",
      approval_status: "pending",
      approved_at: null,
      approved_by: null,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível preparar o perfil.");
  }
}

export async function POST(request: Request) {
  const { requestId, logger } = getApiContext(request, "auth-register");

  if (!hasSupabaseServiceRole()) {
    return jsonError("Cadastro seguro não configurado. Configure SUPABASE_SERVICE_ROLE_KEY.", {
      status: 500,
      requestId,
      code: "supabase_service_role_missing",
    });
  }

  const parsed = RegisterInput.safeParse(await parseJson(request));
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message || "Dados invalidos.", {
      status: 400,
      requestId,
      code: "validation_failed",
      details: { issues: parsed.error.issues },
    });
  }

  const { name, email, password } = parsed.data;
  const cleanEmail = email.toLowerCase();
  const service = getSupabaseAdminClient();

  const created = await service.auth.admin.createUser({
    email: cleanEmail,
    password,
    email_confirm: true,
    user_metadata: { name },
  });

  if (created.error || !created.data.user) {
    const message = created.error?.message?.toLowerCase() || "";
    if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
      return jsonError("Esse e-mail já tem uma conta. Use Entrar ou fale com o administrador.", {
        status: 409,
        requestId,
        code: "email_taken",
      });
    }
    if (message.includes("invalid")) {
      return jsonError("Use um e-mail real e válido.", {
        status: 400,
        requestId,
        code: "invalid_email",
      });
    }
    logger.error("auth.register.createUserFailed", { supabaseMessage: created.error?.message });
    return jsonError("Não foi possível criar a conta agora.", {
      status: 500,
      requestId,
      code: "create_user_failed",
    });
  }

  const userId = created.data.user.id;
  try {
    await upsertPendingProfile({ userId, name });
  } catch (err) {
    logger.error("auth.register.profileUpsertFailed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Rollback: deleta o user que criamos para nao deixar orfao.
    await service.auth.admin.deleteUser(userId);
    return jsonError("Não foi possível preparar o perfil da conta.", {
      status: 500,
      requestId,
      code: "profile_upsert_failed",
    });
  }

  return jsonResult(true, {
    status: "pending",
    message: "Conta criada. Ela precisa ser aprovada pelo administrador principal.",
  }, { requestId });
}
