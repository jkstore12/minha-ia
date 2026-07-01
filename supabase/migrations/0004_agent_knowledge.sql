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

create index if not exists agent_knowledge_user_agent_idx
on public.agent_knowledge(user_id, agent_id, is_active, priority, updated_at desc);

create index if not exists agent_knowledge_user_kind_idx
on public.agent_knowledge(user_id, kind, updated_at desc);

drop trigger if exists set_agent_knowledge_updated_at on public.agent_knowledge;
create trigger set_agent_knowledge_updated_at before update on public.agent_knowledge
for each row execute function public.set_updated_at();

alter table public.agent_knowledge enable row level security;

drop policy if exists "Users can manage own agent knowledge" on public.agent_knowledge;
create policy "Users can manage own agent knowledge"
on public.agent_knowledge for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.agent_knowledge to authenticated;
