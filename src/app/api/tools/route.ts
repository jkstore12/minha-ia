import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedSupabase, jsonError, parseJson } from "@/lib/api/server";
import { AgentToolError, getToolSummary, listAgentTools, runAgentTool } from "@/lib/agent-tools/registry";
import { hasSupabaseEnv } from "@/lib/env";

export const runtime = "nodejs";

const runToolSchema = z.object({
  toolId: z.string().min(1),
  input: z.unknown().optional(),
});

function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => issue.message).join(" ");
}

export async function GET() {
  if (!hasSupabaseEnv()) {
    return jsonError("Supabase não configurado para autenticar a Central de Ferramentas.", 503);
  }

  const { user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada ou usuário sem acesso aprovado.", 401);

  return NextResponse.json({
    tools: listAgentTools(),
    summary: getToolSummary(),
  });
}

export async function POST(request: Request) {
  if (!hasSupabaseEnv()) {
    return jsonError("Supabase não configurado para autenticar a Central de Ferramentas.", 503);
  }

  const { user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada ou usuário sem acesso aprovado.", 401);

  const body = await parseJson(request);
  const parsed = runToolSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(formatZodError(parsed.error), 400);
  }

  try {
    const run = await runAgentTool(parsed.data.toolId, parsed.data.input);
    return NextResponse.json({ run });
  } catch (error) {
    if (error instanceof AgentToolError) {
      return jsonError(error.message, error.status);
    }

    if (error instanceof z.ZodError) {
      return jsonError(formatZodError(error), 400);
    }

    const message = error instanceof Error ? error.message : "Não foi possível executar a ferramenta.";
    return jsonError(message, 500);
  }
}
