alter table public.scheduled_tasks
  add column if not exists metadata jsonb not null default '{}'::jsonb;
