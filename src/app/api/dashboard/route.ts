import { NextResponse } from "next/server";
import { getAuthedSupabase, jsonError } from "@/lib/api/server";

export const runtime = "nodejs";

export async function GET() {
  const { supabase, user } = await getAuthedSupabase();
  if (!user) return jsonError("Sessão expirada.", 401);

  const [agents, conversations, memories, tasks, logs] = await Promise.all([
    supabase.from("agents").select("id, status, is_active, total_runs, success_runs, error_runs", { count: "exact" }).eq("user_id", user.id),
    supabase.from("conversations").select("id", { count: "exact" }).eq("user_id", user.id),
    supabase.from("memories").select("id", { count: "exact" }).eq("user_id", user.id),
    supabase.from("scheduled_tasks").select("id, is_active", { count: "exact" }).eq("user_id", user.id),
    supabase.from("agent_logs").select("id, level, message, created_at", { count: "exact" }).eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
  ]);

  return NextResponse.json({
    metrics: {
      agents: agents.count || 0,
      activeAgents: (agents.data || []).filter((agent) => agent.is_active).length,
      conversations: conversations.count || 0,
      memories: memories.count || 0,
      scheduledTasks: tasks.count || 0,
      activeTasks: (tasks.data || []).filter((task) => task.is_active).length,
      totalRuns: (agents.data || []).reduce((sum, agent) => sum + Number(agent.total_runs || 0), 0),
      successRuns: (agents.data || []).reduce((sum, agent) => sum + Number(agent.success_runs || 0), 0),
      errorRuns: (agents.data || []).reduce((sum, agent) => sum + Number(agent.error_runs || 0), 0),
    },
    recentLogs: logs.data || [],
  });
}
