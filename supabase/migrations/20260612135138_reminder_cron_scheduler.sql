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
