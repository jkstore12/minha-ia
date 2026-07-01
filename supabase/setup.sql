create extension if not exists "pgcrypto";
create schema if not exists private;
grant usage on schema private to authenticated;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferences jsonb not null default '{}'::jsonb,
  role text not null default 'user' check (role in ('admin', 'user')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'blocked')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null default 'chat-attachments',
  storage_path text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('preference', 'goal', 'fact', 'style', 'constraint')),
  content text not null,
  confidence numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_conversation_id uuid references public.conversations(id) on delete set null,
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
  metadata jsonb not null default '{}'::jsonb,
  connector_id uuid references public.api_connectors(id) on delete set null,
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

create table if not exists public.agent_knowledge (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  title text not null,
  kind text not null default 'other' check (
    kind in ('product', 'price', 'policy', 'faq', 'document', 'service', 'instruction', 'other')
  ),
  content text not null,
  tags text[] not null default '{}'::text[],
  source_url text,
  priority integer not null default 3 check (priority >= 1 and priority <= 5),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  notification_channels text[] not null default array['telegram', 'whatsapp']::text[],
  notified_at timestamptz,
  notification_status text check (notification_status is null or notification_status in ('pending', 'running', 'sent', 'error')),
  notification_error text,
  metadata jsonb not null default '{}'::jsonb,
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

create index if not exists conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index if not exists user_profiles_role_idx on public.user_profiles(role);
create index if not exists user_profiles_approval_status_idx on public.user_profiles(approval_status);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index if not exists messages_user_idx on public.messages(user_id);
create index if not exists message_attachments_message_idx on public.message_attachments(message_id);
create index if not exists message_attachments_user_created_idx on public.message_attachments(user_id, created_at desc);
create index if not exists memories_user_updated_idx on public.memories(user_id, updated_at desc);
create index if not exists agents_user_updated_idx on public.agents(user_id, updated_at desc);
create index if not exists agents_user_active_idx on public.agents(user_id, is_active);
create index if not exists agent_knowledge_user_agent_idx on public.agent_knowledge(user_id, agent_id, is_active, priority, updated_at desc);
create index if not exists agent_knowledge_user_kind_idx on public.agent_knowledge(user_id, kind, updated_at desc);
create index if not exists connectors_user_updated_idx on public.api_connectors(user_id, updated_at desc);
create index if not exists logs_user_created_idx on public.agent_logs(user_id, created_at desc);
create index if not exists logs_agent_created_idx on public.agent_logs(agent_id, created_at desc);
create index if not exists scheduled_user_updated_idx on public.scheduled_tasks(user_id, updated_at desc);
create index if not exists scheduled_tasks_due_reminders_idx
on public.scheduled_tasks(user_id, next_run_at)
where cron_expression = 'reminder' and is_active = true;
create index if not exists executions_task_started_idx on public.task_executions(scheduled_task_id, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.is_platform_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = check_user_id
      and role = 'admin'
      and approval_status = 'approved'
  );
$$;

grant execute on function private.is_platform_admin(uuid) to authenticated;

create or replace function private.protect_user_profile_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if auth.uid() is not null and old.id = auth.uid() then
    new.role := old.role;
    new.approval_status := old.approval_status;
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  end if;

  return new;
end;
$$;

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists protect_user_profile_admin_fields on public.user_profiles;
create trigger protect_user_profile_admin_fields before update on public.user_profiles
for each row execute function private.protect_user_profile_admin_fields();

drop trigger if exists set_conversations_updated_at on public.conversations;
create trigger set_conversations_updated_at before update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists set_memories_updated_at on public.memories;
create trigger set_memories_updated_at before update on public.memories
for each row execute function public.set_updated_at();

drop trigger if exists set_api_connectors_updated_at on public.api_connectors;
create trigger set_api_connectors_updated_at before update on public.api_connectors
for each row execute function public.set_updated_at();

drop trigger if exists set_agents_updated_at on public.agents;
create trigger set_agents_updated_at before update on public.agents
for each row execute function public.set_updated_at();

drop trigger if exists set_agent_knowledge_updated_at on public.agent_knowledge;
create trigger set_agent_knowledge_updated_at before update on public.agent_knowledge
for each row execute function public.set_updated_at();

drop trigger if exists set_scheduled_tasks_updated_at on public.scheduled_tasks;
create trigger set_scheduled_tasks_updated_at before update on public.scheduled_tasks
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.memories enable row level security;
alter table public.api_connectors enable row level security;
alter table public.agents enable row level security;
alter table public.agent_knowledge enable row level security;
alter table public.agent_logs enable row level security;
alter table public.scheduled_tasks enable row level security;
alter table public.task_executions enable row level security;

drop policy if exists "Users can read own profile" on public.user_profiles;
create policy "Users can read own profile"
on public.user_profiles for select
to authenticated
using (id = auth.uid());

drop policy if exists "Users can insert own profile" on public.user_profiles;
create policy "Users can insert own profile"
on public.user_profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Users can update own profile" on public.user_profiles;
create policy "Users can update own profile"
on public.user_profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Admins can read all profiles" on public.user_profiles;
create policy "Admins can read all profiles"
on public.user_profiles for select
to authenticated
using (private.is_platform_admin());

drop policy if exists "Admins can update all profiles" on public.user_profiles;
create policy "Admins can update all profiles"
on public.user_profiles for update
to authenticated
using (private.is_platform_admin())
with check (private.is_platform_admin());

drop policy if exists "Users can manage own conversations" on public.conversations;
create policy "Users can manage own conversations"
on public.conversations for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can read own messages" on public.messages;
create policy "Users can read own messages"
on public.messages for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own messages" on public.messages;
create policy "Users can insert own messages"
on public.messages for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  )
);

drop policy if exists "Users can read own message attachments" on public.message_attachments;
create policy "Users can read own message attachments"
on public.message_attachments for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own message attachments" on public.message_attachments;
create policy "Users can insert own message attachments"
on public.message_attachments for insert
to authenticated
with check (
  user_id = auth.uid()
  and bucket_id = 'chat-attachments'
  and storage_path like (auth.uid()::text || '/%')
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.user_id = auth.uid()
  )
);

drop policy if exists "Users can manage own memories" on public.memories;
create policy "Users can manage own memories"
on public.memories for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own connectors" on public.api_connectors;
create policy "Users can manage own connectors"
on public.api_connectors for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own agents" on public.agents;
create policy "Users can manage own agents"
on public.agents for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can manage own agent knowledge" on public.agent_knowledge;
create policy "Users can manage own agent knowledge"
on public.agent_knowledge for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can read own logs" on public.agent_logs;
create policy "Users can read own logs"
on public.agent_logs for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert own logs" on public.agent_logs;
create policy "Users can insert own logs"
on public.agent_logs for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can manage own scheduled tasks" on public.scheduled_tasks;
create policy "Users can manage own scheduled tasks"
on public.scheduled_tasks for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can read own task executions" on public.task_executions;
create policy "Users can read own task executions"
on public.task_executions for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert own task executions" on public.task_executions;
create policy "Users can insert own task executions"
on public.task_executions for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own task executions" on public.task_executions;
create policy "Users can update own task executions"
on public.task_executions for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_profiles, public.conversations, public.messages, public.memories to authenticated;
grant select, insert on public.message_attachments to authenticated;
grant select, insert, update, delete on public.api_connectors, public.agents, public.agent_knowledge, public.scheduled_tasks to authenticated;
grant select, insert on public.agent_logs to authenticated;
grant select, insert, update on public.task_executions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 26214400, null)
on conflict (id) do update
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = null;

drop policy if exists "Users can upload own chat attachments" on storage.objects;
create policy "Users can upload own chat attachments"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can read own chat attachments" on storage.objects;
create policy "Users can read own chat attachments"
on storage.objects for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own chat attachments" on storage.objects;
create policy "Users can update own chat attachments"
on storage.objects for update
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own chat attachments" on storage.objects;
create policy "Users can delete own chat attachments"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
  from cron.job
  where jobname = 'minha_ia_due_reminders_every_minute'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'minha_ia_due_reminders_every_minute',
  '* * * * *',
  $cron$
    select net.http_get(
      url := 'https://minha-ia-orquestrador.vercel.app/api/cron/reminders',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || coalesce((
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'CRON_SECRET'
          limit 1
        ), ''),
        'User-Agent',
        'Supabase-Cron/minha-ia'
      ),
      timeout_milliseconds := 25000
    );
  $cron$
);
