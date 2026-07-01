export type AgentDomain = "orchestrator" | "research" | "analysis" | "content" | "automation" | "support" | "fallback" | "custom";

export type AgentConfig = {
  id: string;
  name: string;
  description: string | null;
  domain: AgentDomain;
  model: string | null;
  temperature: number;
  max_tokens: number;
  system_prompt: string | null;
  tools: string[];
  is_active: boolean;
  is_orchestrator: boolean;
  is_fallback: boolean;
  status: string;
  total_runs: number;
  success_runs: number;
  error_runs: number;
  created_at: string;
  updated_at: string;
};

export type ApiConnector = {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  auth_type: string;
  credential_hint: string | null;
  headers: Record<string, unknown>;
  rate_limit_per_minute: number;
  timeout_ms: number;
  is_active: boolean;
  last_ping_at: string | null;
  last_ping_ok: boolean | null;
  created_at: string;
  updated_at: string;
};

export type ScheduledTask = {
  id: string;
  agent_id: string | null;
  title: string;
  prompt: string;
  recurrence: string;
  cron_expression: string | null;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
};
