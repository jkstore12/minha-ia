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

create index if not exists message_attachments_message_idx
on public.message_attachments(message_id);

create index if not exists message_attachments_user_created_idx
on public.message_attachments(user_id, created_at desc);

alter table public.message_attachments enable row level security;

drop policy if exists "Users can read own message attachments" on public.message_attachments;
create policy "Users can read own message attachments"
on public.message_attachments for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages m
    where m.id = message_attachments.message_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Users can insert own message attachments" on public.message_attachments;
create policy "Users can insert own message attachments"
on public.message_attachments for insert
to authenticated
with check (
  user_id = auth.uid()
  and bucket_id = 'chat-attachments'
  and exists (
    select 1 from public.messages m
    where m.id = message_attachments.message_id
      and m.user_id = auth.uid()
  )
);

grant select, insert on public.message_attachments to authenticated;

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
