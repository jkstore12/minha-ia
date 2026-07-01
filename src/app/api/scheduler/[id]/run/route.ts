import { NextResponse } from "next/server";
import { extractBrainUpdates, runBrain, type Memory } from "@/lib/ai/brain";
import { hasAiEnv } from "@/lib/env";
import { getAuthedSupabase, jsonError } from "@/lib/api/server";
import { truncateTitle } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasAiEnv()) return jsonError("IA não configurada.", 503);

  const { id } = await context.params;
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const { data: task, error: taskError } = await supabase
    .from("scheduled_tasks")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (taskError || !task) return jsonError("Agendamento não encontrado.", 404);

  const { data: conversation } = await supabase
    .from("conversations")
    .insert({ user_id: user.id, title: truncateTitle(`[Agendado] ${task.title}`) })
    .select("id, summary")
    .single();

  if (!conversation) return jsonError("Não foi possível criar conversa para execução.", 500);

  const { data: memories } = await supabase
    .from("memories")
    .select("kind, content, confidence")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(30);

  const { data: execution } = await supabase
    .from("task_executions")
    .insert({ user_id: user.id, scheduled_task_id: id, conversation_id: conversation.id, status: "running" })
    .select("id")
    .single();

  try {
    const result = await runBrain({
      userMessage: task.prompt,
      recentMessages: [],
      memories: (memories || []) as Memory[],
      conversationSummary: conversation.summary,
    });
    const output = result.text;

    await supabase.from("messages").insert([
      { conversation_id: conversation.id, user_id: user.id, role: "user", content: task.prompt },
      { conversation_id: conversation.id, user_id: user.id, role: "assistant", content: output },
    ]);

    await supabase.from("task_executions").update({ status: "success", output, finished_at: new Date().toISOString() }).eq("id", execution?.id);
    await supabase.from("scheduled_tasks").update({ last_run_at: new Date().toISOString(), last_status: "success" }).eq("id", id).eq("user_id", user.id);
    await supabase.from("agent_logs").insert({
      user_id: user.id,
      conversation_id: conversation.id,
      level: "success",
      message: `Agendamento executado: ${task.title}`,
      metadata: { used_model: result.usedModel, fallback_used: result.fallbackUsed, model_attempts: result.attempts },
    });

    const updates = await extractBrainUpdates({ userMessage: task.prompt, assistantMessage: output });
    if (updates.memories.length) {
      await supabase.from("memories").insert(
        updates.memories.map((memory) => ({
          user_id: user.id,
          kind: memory.kind,
          content: memory.content,
          confidence: memory.confidence,
          source_conversation_id: conversation.id,
        })),
      );
    }

    return NextResponse.json({ ok: true, conversationId: conversation.id, output });
  } catch {
    await supabase.from("task_executions").update({ status: "error", error: "Falha ao executar IA.", finished_at: new Date().toISOString() }).eq("id", execution?.id);
    await supabase.from("scheduled_tasks").update({ last_run_at: new Date().toISOString(), last_status: "error" }).eq("id", id).eq("user_id", user.id);
    return jsonError("Não foi possível executar o agendamento.", 502);
  }
}
