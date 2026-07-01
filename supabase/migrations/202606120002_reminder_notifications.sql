alter table public.scheduled_tasks
  add column if not exists notification_channels text[] not null default array['telegram', 'whatsapp']::text[],
  add column if not exists notified_at timestamptz,
  add column if not exists notification_status text,
  add column if not exists notification_error text;

alter table public.scheduled_tasks
  drop constraint if exists scheduled_tasks_notification_status_check;

alter table public.scheduled_tasks
  add constraint scheduled_tasks_notification_status_check
  check (notification_status is null or notification_status in ('pending', 'running', 'sent', 'error'));

create index if not exists scheduled_tasks_due_reminders_idx
on public.scheduled_tasks(user_id, next_run_at)
where cron_expression = 'reminder' and is_active = true;

