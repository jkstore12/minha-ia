create table if not exists public.personal_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  chat_id text not null,
  contact_number text not null,
  contact_name text,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound', 'ignored')),
  content text not null default '',
  classification text not null default 'normal' check (classification in ('normal', 'urgent', 'vip', 'restricted', 'spam', 'command', 'ignored')),
  urgency_score integer not null default 0 check (urgency_score >= 0 and urgency_score <= 100),
  is_vip boolean not null default false,
  is_group boolean not null default false,
  is_spam boolean not null default false,
  response_text text,
  owner_notified boolean not null default false,
  notification_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists personal_whatsapp_messages_user_message_idx
on public.personal_whatsapp_messages(user_id, message_id);

create index if not exists personal_whatsapp_messages_user_created_idx
on public.personal_whatsapp_messages(user_id, created_at desc);

create index if not exists personal_whatsapp_messages_user_classification_idx
on public.personal_whatsapp_messages(user_id, classification, created_at desc);

drop trigger if exists set_personal_whatsapp_messages_updated_at on public.personal_whatsapp_messages;
create trigger set_personal_whatsapp_messages_updated_at before update on public.personal_whatsapp_messages
for each row execute function public.set_updated_at();

alter table public.personal_whatsapp_messages enable row level security;

drop policy if exists "Users can read own personal WhatsApp messages" on public.personal_whatsapp_messages;
create policy "Users can read own personal WhatsApp messages"
on public.personal_whatsapp_messages for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert own personal WhatsApp messages" on public.personal_whatsapp_messages;
create policy "Users can insert own personal WhatsApp messages"
on public.personal_whatsapp_messages for insert
to authenticated
with check (user_id = auth.uid());

grant select, insert on public.personal_whatsapp_messages to authenticated;
