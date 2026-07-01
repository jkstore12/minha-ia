create extension if not exists "pgcrypto";

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nova conversa',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('preference', 'goal', 'fact', 'style', 'constraint')),
  content text not null,
  confidence numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index messages_conversation_created_idx on public.messages(conversation_id, created_at);
create index messages_user_idx on public.messages(user_id);
create index memories_user_updated_idx on public.memories(user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_user_profiles_updated_at before update on public.user_profiles
for each row execute function public.set_updated_at();

create trigger set_conversations_updated_at before update on public.conversations
for each row execute function public.set_updated_at();

create trigger set_memories_updated_at before update on public.memories
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;

create policy "Users can read own profile"
on public.user_profiles for select
to authenticated
using (id = auth.uid());

create policy "Users can insert own profile"
on public.user_profiles for insert
to authenticated
with check (id = auth.uid());

create policy "Users can update own profile"
on public.user_profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "Users can manage own conversations"
on public.conversations for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

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

create policy "Users can manage own memories"
on public.memories for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_profiles, public.conversations, public.messages, public.memories to authenticated;
