alter table public.agents
  add column if not exists metadata jsonb not null default '{}'::jsonb;

