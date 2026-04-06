-- ============================================================================
-- Migration 33: Allow service contexts to create/delete secrets on behalf of users
-- ============================================================================

create or replace function public.create_secret(
  secret_name text,
  secret_value text,
  requester uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  effective_requester uuid := coalesce(requester, auth.uid());
  secret_id uuid;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;
  return secret_id;
end;
$$;

revoke all on function public.create_secret(text, text, uuid) from public, anon;
grant execute on function public.create_secret(text, text, uuid) to authenticated, service_role;

create or replace function public.delete_secret(
  secret_name text,
  requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  effective_requester uuid := coalesce(requester, auth.uid());
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = effective_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  delete from vault.secrets where name = secret_name;
end;
$$;

revoke all on function public.delete_secret(text, uuid) from public, anon;
grant execute on function public.delete_secret(text, uuid) to authenticated, service_role;
