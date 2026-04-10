-- Delete a user-owned API key and its Vault secret inside one transaction boundary.
-- This keeps profile references, api_keys metadata, and Vault state aligned on mixed failures.

create or replace function public.delete_api_key(
  api_key_id uuid,
  requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  target_secret_name text;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role <> 'service_role' and effective_requester <> caller_uid then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  select vault_secret_name
    into target_secret_name
  from public.api_keys
  where id = api_key_id
    and user_id = effective_requester
  for update;

  if target_secret_name is null then
    raise exception 'API key not found'
      using errcode = 'P0002';
  end if;

  update public.profiles
  set voyage_embedding_api_key_id = null,
      enable_episodic_rag = false
  where id = effective_requester
    and voyage_embedding_api_key_id = api_key_id;

  delete from public.api_keys
  where id = api_key_id
    and user_id = effective_requester;

  delete from vault.secrets
  where name = target_secret_name;
end;
$$;

revoke all on function public.delete_api_key(uuid, uuid) from public, anon;
grant execute on function public.delete_api_key(uuid, uuid) to authenticated, service_role;
