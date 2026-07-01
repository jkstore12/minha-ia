create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  domain text not null default 'custom' check (
    domain in ('orchestrator', 'research', 'analysis', 'content', 'automation', 'support', 'fallback', 'custom')
  ),
  model text,
  temperature numeric(3,2) not null default 0.70 check (temperature >= 0 and temperature <= 2),
  max_tokens integer not null default 4096 check (max_tokens >= 256 and max_tokens <= 128000),
  system_prompt text,
  tools text[] not null default '{}'::text[],
  connector_id uuid,
  is_active boolean not null default true,
  is_orchestrator boolean not null default false,
  is_fallback boolean not null default false,
  status text not null default 'idle' check (status in ('idle', 'running', 'error', 'disabled')),
  total_runs integer not null default 0,
  success_runs integer not null default 0,
  error_runs integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.api_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider text not null default 'openai_compatible' check (
    provider in ('openai', 'openrouter', 'anthropic', 'google', 'openai_compatible', 'custom')
  ),
  base_url text not null,
  auth_type text not null default 'bearer_token' check (auth_type in ('bearer_token', 'api_key', 'basic_auth', 'none')),
  credential_hint text,
  headers jsonb not null default '{}'::jsonb,
  rate_limit_per_minute integer not null default 60,
  timeout_ms integer not null default 30000,
  is_active boolean not null default true,
  last_ping_at timestamptz,
  last_ping_ok boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agents
  add constraint agents_connector_id_fkey
  foreign key (connector_id) references public.api_connectors(id) on delete set null;

create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error', 'success')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  title text not null,
  prompt text not null,
  recurrence text not null default 'daily' check (recurrence in ('hourly', 'daily', 'weekly', 'monthly', 'custom')),
  cron_expression text,
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text check (last_status is null or last_status in ('success', 'error', 'running')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_task_id uuid not null references public.scheduled_tasks(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  output text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agents_user_updated_idx on public.agents(user_id, updated_at desc);
create index if not exists agents_user_active_idx on public.agents(user_id, is_active);
create index if not exists connectors_user_updated_idx on public.api_connectors(user_id, updated_at desc);
create index if not exists logs_user_created_idx on public.agent_logs(user_id, created_at desc);
create index if not exists logs_agent_created_idx on public.agent_logs(agent_id, created_at desc);
create index if not exists scheduled_user_updated_idx on public.scheduled_tasks(user_id, updated_at desc);
create index if not exists executions_task_started_idx on public.task_executions(scheduled_task_id, started_at desc);

create trigger set_agents_updated_at before update on public.agents
for each row execute function public.set_updated_at();

create trigger set_api_connectors_updated_at before update on public.api_connectors
for each row execute function public.set_updated_at();

create trigger set_scheduled_tasks_updated_at before update on public.scheduled_tasks
for each row execute function public.set_updated_at();

alter table public.agents enable row level security;
alter table public.api_connectors enable row level security;
alter table public.agent_logs enable row level security;
alter table public.scheduled_tasks enable row level security;
alter table public.task_executions enable row level security;

create policy "Users can manage own agents"
on public.agents for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can manage own connectors"
on public.api_connectors for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can read own logs"
on public.agent_logs for select
to authenticated
using (user_id = auth.uid());

create policy "Users can insert own logs"
on public.agent_logs for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users can manage own scheduled tasks"
on public.scheduled_tasks for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can read own task executions"
on public.task_executions for select
to authenticated
using (user_id = auth.uid());

create policy "Users can insert own task executions"
on public.task_executions for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users can update own task executions"
on public.task_executions for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.agents, public.api_connectors, public.scheduled_tasks to authenticated;
grant select, insert on public.agent_logs to authenticated;
grant select, insert, update on public.task_executions to authenticated;
