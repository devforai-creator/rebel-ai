-- The full UUID namespace is required for new bindings. Existing keys may
-- still use the historical 12-character UUID prefix.
create function public.api_key_secret_name_matches_owner(
  secret_name text,
  owner_id uuid,
  allow_legacy boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from (values
      ('apikey_' || owner_id::text || '_'),
      (case when allow_legacy then 'apikey_' || left(replace(owner_id::text, '-', ''), 12) || '_' end)
    ) as prefixes(prefix)
    where starts_with(secret_name, prefix)
      and substr(secret_name, length(prefix) + 1) ~ '^[a-z0-9_]+$'
  );
$$;

revoke all on function public.api_key_secret_name_matches_owner(text, uuid, boolean)
  from public, anon, authenticated, service_role;

create function public.validate_api_key_secret_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.user_id is not distinct from old.user_id
    and new.vault_secret_name is not distinct from old.vault_secret_name then
    return new;
  end if;

  if not public.api_key_secret_name_matches_owner(new.vault_secret_name, new.user_id, false) then
    raise exception 'Vault secret name must belong to the API key owner'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger validate_api_key_secret_binding
  before insert or update of user_id, vault_secret_name on public.api_keys
  for each row execute function public.validate_api_key_secret_binding();

revoke all on function public.validate_api_key_secret_binding()
  from public, anon, authenticated, service_role;

create or replace function public.get_decrypted_secret(
  secret_name text,
  requester uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_requester uuid := coalesce(requester, auth.uid());
  secret_value text;
begin
  if not public.api_key_secret_name_matches_owner(secret_name, effective_requester, true)
    or not exists (
      select 1
      from public.api_keys
      where vault_secret_name = secret_name
        and user_id = effective_requester
    ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select decrypted_secret
    into secret_value
  from vault.decrypted_secrets
  where name = secret_name;

  if secret_value is null then
    raise exception 'Secret not found' using errcode = 'P0002';
  end if;
  return secret_value;
end;
$$;

create or replace function public.delete_api_key(
  api_key_id uuid,
  requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  target_secret_name text;
begin
  if effective_requester is null
    or (caller_role is distinct from 'service_role'
      and effective_requester is distinct from caller_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select vault_secret_name
    into target_secret_name
  from public.api_keys
  where id = api_key_id
    and user_id = effective_requester
  for update;

  if target_secret_name is null then
    raise exception 'API key not found' using errcode = 'P0002';
  end if;

  update public.profiles
  set voyage_embedding_api_key_id = null,
      enable_episodic_rag = false
  where id = effective_requester
    and voyage_embedding_api_key_id = api_key_id;

  delete from public.api_keys
  where id = api_key_id
    and user_id = effective_requester;

  -- Old forged bindings can be removed without touching the referenced secret.
  if public.api_key_secret_name_matches_owner(target_secret_name, effective_requester, true) then
    delete from vault.secrets
    where name = target_secret_name;
  end if;
end;
$$;
