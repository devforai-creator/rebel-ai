-- Harden Vault write helpers so only trusted service-role paths can mutate
-- secrets, while still allowing service contexts to act on behalf of a user.

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
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  secret_id uuid;
  expected_prefix text;
  suffix text;
  max_keys constant integer := 10;
  current_key_count integer;
begin
  if effective_requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated create_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role is distinct from 'service_role' and effective_requester <> caller_uid then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'requester mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || effective_requester::text || '_';

  if left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'prefix mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if suffix !~ '^[a-z0-9_]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  select count(*) into current_key_count
  from public.api_keys
  where user_id = effective_requester;

  if current_key_count >= max_keys then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'api key quota exceeded');
    raise exception 'API key quota exceeded'
      using errcode = '54013';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (effective_requester, secret_name, 'create', null);

  return secret_id;
end;
$$;

revoke all on function public.create_secret(text, text) from public, anon, authenticated, service_role;
revoke all on function public.create_secret(text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_secret(text, text, uuid) to service_role;

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
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  expected_prefix text;
  legacy_prefix text;
  suffix text;
begin
  if effective_requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated delete_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role is distinct from 'service_role' and effective_requester <> caller_uid then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'requester mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || effective_requester::text || '_';
  legacy_prefix := 'apikey_' || left(replace(effective_requester::text, '-', ''), 12) || '_';

  if left(secret_name, length(expected_prefix)) = expected_prefix then
    suffix := substring(secret_name from length(expected_prefix) + 1);
  elsif left(secret_name, length(legacy_prefix)) = legacy_prefix then
    suffix := substring(secret_name from length(legacy_prefix) + 1);
  else
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'ownership check failed');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if suffix !~ '^[a-z0-9_]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  delete from vault.secrets
  where name = secret_name;

  if not found then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (effective_requester, secret_name, 'attempt_denied', 'secret not found');
    raise exception 'Secret not found'
      using errcode = 'P0002';
  end if;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (effective_requester, secret_name, 'delete', null);
end;
$$;

revoke all on function public.delete_secret(text) from public, anon, authenticated, service_role;
revoke all on function public.delete_secret(text, uuid) from public, anon, authenticated;
grant execute on function public.delete_secret(text, uuid) to service_role;
