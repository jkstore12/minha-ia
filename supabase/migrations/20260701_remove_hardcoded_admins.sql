-- Remove hard-coded admin emails
-- =================================================================
-- A migration 20260606132947_admin_user_approval.sql promovia dois
-- emails especificos a admin direto no SQL:
--   wnbatista1@gmail.com
--   jksv149@gmail.com
-- Isso expunha credenciais no git e dava admin automatico a qualquer
-- recriacao do banco.
--
-- Este arquivo:
-- 1. Documenta a nova politica (admins vem de ADMIN_EMAILS env var,
--    checada em src/lib/admin/access.ts).
-- 2. Disponibiliza funcoes idempotentes para revogar admins por lista
--    de emails e re-promover usuarios a partir de uma lista.
-- 3. NAO executa nenhuma acao destrutiva automaticamente. O operador
--    decide quando chamar as funcoes.
-- =================================================================

-- Revoga o papel de admin para uma lista de emails. Idempotente: emails
-- que nao sao admin ou nao existem sao ignorados. Limpa approved_by
-- para manter auditoria consistente.
create or replace function private.revoke_admin_for_emails(target_emails text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with target as (
    select lower(trim(value)) as email
    from unnest(target_emails) as value
    where value is not null and trim(value) <> ''
  )
  update public.user_profiles as profile
  set role = 'user',
      approval_status = 'approved',
      approved_by = null
  from auth.users as auth_user
  join target on target.email = lower(auth_user.email)
  where auth_user.id = profile.id
    and profile.role = 'admin';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function private.revoke_admin_for_emails(text[]) to service_role;

-- Promove usuarios para admin a partir de uma lista de emails.
-- Idempotente. Usar com cuidado: em prod, idealmente chamada por
-- um job controlado (nao direto no client).
create or replace function private.grant_admin_for_emails(target_emails text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with target as (
    select lower(trim(value)) as email
    from unnest(target_emails) as value
    where value is not null and trim(value) <> ''
  )
  update public.user_profiles as profile
  set role = 'admin',
      approval_status = 'approved',
      approved_at = coalesce(profile.approved_at, now())
  from auth.users as auth_user
  join target on target.email = lower(auth_user.email)
  where auth_user.id = profile.id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function private.grant_admin_for_emails(text[]) to service_role;

-- Comentario na tabela documentando a politica.
comment on column public.user_profiles.role is
  'Papel do usuario. Promocoes a admin devem ser feitas via env var ADMIN_EMAILS (checada em src/lib/admin/access.ts::ensureUserAccess) ou pela funcao private.grant_admin_for_emails.';
