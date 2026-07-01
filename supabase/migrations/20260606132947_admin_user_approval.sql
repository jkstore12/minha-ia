create schema if not exists private;
grant usage on schema private to authenticated;

alter table public.user_profiles
  add column if not exists role text not null default 'user',
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_role_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_role_check check (role in ('admin', 'user'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_approval_status_check'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_approval_status_check check (approval_status in ('pending', 'approved', 'blocked'));
  end if;
end $$;

create index if not exists user_profiles_role_idx on public.user_profiles(role);
create index if not exists user_profiles_approval_status_idx on public.user_profiles(approval_status);

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

drop trigger if exists protect_user_profile_admin_fields on public.user_profiles;
create trigger protect_user_profile_admin_fields
before update on public.user_profiles
for each row
execute function private.protect_user_profile_admin_fields();

update public.user_profiles
set approval_status = 'approved',
    approved_at = coalesce(approved_at, now())
where approval_status = 'pending';

-- Promocoes hard-coded de admin REMOVIDAS por questao de seguranca
-- (emails no git = credential leak). Promocoes a admin agora sao
-- controladas pela env var ADMIN_EMAILS, checada em
-- src/lib/admin/access.ts::ensureUserAccess. A migration
-- 20260701_remove_hardcoded_admins.sql expoe funcoes SQL
-- (private.grant_admin_for_emails, private.revoke_admin_for_emails)
-- para operacoes manuais a partir de DBs ja existentes.

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
