-- Reconcile local migrations with the current production public schema.
-- This file captures production-only drift discovered via `supabase db diff --linked`.

CREATE INDEX IF NOT EXISTS idx_character_assets_display_order ON public.character_assets USING btree (character_id, display_order);

CREATE INDEX IF NOT EXISTS idx_module_assets_order ON public.module_assets USING btree (user_id, module_id, display_order);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.check_anon_rate_limit(identifier text, window_seconds integer, max_requests integer)
 RETURNS TABLE(allowed boolean, remaining integer, retry_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bucket_start timestamptz;
  request_total integer;
  epoch_now integer;
begin
  if identifier is null or length(identifier) = 0 then
    raise exception 'identifier is required'
      using errcode = '22004';
  end if;

  if window_seconds is null or window_seconds <= 0 then
    raise exception 'window_seconds must be positive'
      using errcode = '22023';
  end if;

  if max_requests is null or max_requests <= 0 then
    raise exception 'max_requests must be positive'
      using errcode = '22023';
  end if;

  epoch_now := floor(extract(epoch from now()))::integer;
  bucket_start :=
    to_timestamp((epoch_now / window_seconds) * window_seconds)::timestamptz;

  insert into public.anon_rate_limits (identifier, window_start, request_count)
    values (identifier, bucket_start, 1)
  on conflict (identifier, window_start)
    do update set request_count = public.anon_rate_limits.request_count + 1
    returning public.anon_rate_limits.request_count into request_total;

  if request_total <= max_requests then
    allowed := true;
    remaining := max_requests - request_total;
    retry_after := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after := window_seconds - (epoch_now % window_seconds);
  end if;

  delete from public.anon_rate_limits
   where public.anon_rate_limits.identifier = identifier
     and window_start < bucket_start - interval '1 day';

  return query select allowed, remaining, retry_after;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_chat_rate_limit(target_user_id uuid, window_seconds integer, max_requests integer)
 RETURNS TABLE(allowed boolean, remaining integer, retry_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bucket_start timestamptz;
  request_total integer;
  epoch_now integer;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required'
      using errcode = '22004';
  end if;

  if window_seconds is null or window_seconds <= 0 then
    raise exception 'window_seconds must be positive'
      using errcode = '22023';
  end if;

  if max_requests is null or max_requests <= 0 then
    raise exception 'max_requests must be positive'
      using errcode = '22023';
  end if;

  epoch_now := floor(extract(epoch from now()))::integer;
  bucket_start :=
    to_timestamp((epoch_now / window_seconds) * window_seconds)::timestamptz;

  insert into public.chat_rate_limits (user_id, window_start, request_count)
    values (target_user_id, bucket_start, 1)
  on conflict (user_id, window_start)
    do update set request_count = public.chat_rate_limits.request_count + 1
    returning public.chat_rate_limits.request_count into request_total;

  if request_total <= max_requests then
    allowed := true;
    remaining := max_requests - request_total;
    retry_after := 0;
  else
    allowed := false;
    remaining := 0;
    retry_after := window_seconds - (epoch_now % window_seconds);
  end if;

  -- Garbage collect old windows for this user (best effort)
  delete from public.chat_rate_limits
   where user_id = target_user_id
     and window_start < bucket_start - interval '1 day';

  return query select allowed, remaining, retry_after;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_secret(secret_name text, secret_value text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  requester uuid;
  secret_id uuid;
  expected_prefix text;
  suffix text;
  max_keys constant integer := 10;
  current_key_count integer;
begin
  requester := auth.uid();

  if requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated create_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  expected_prefix := 'apikey_' || requester::text || '_';

  if left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'prefix mismatch');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if suffix !~ '^[a-z]+_[0-9]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  select count(*) into current_key_count
  from public.api_keys
  where user_id = requester;

  if current_key_count >= max_keys then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'api key quota exceeded');
    raise exception 'API key quota exceeded'
      using errcode = '54013';
  end if;

  select vault.create_secret(secret_value, secret_name) into secret_id;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (requester, secret_name, 'create', null);

  return secret_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_secret(secret_name text, secret_value text, requester uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.delete_secret(secret_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  requester uuid;
  expected_prefix text;
  suffix text;
  requester_prefix text;
begin
  requester := auth.uid();

  if requester is null then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (null, coalesce(secret_name, ''), 'attempt_denied', 'unauthenticated delete_secret call');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if secret_name is null or length(secret_name) = 0 then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, coalesce(secret_name, ''), 'attempt_denied', 'secret name required');
    raise exception 'Secret name required'
      using errcode = '22004';
  end if;

  requester_prefix := 'apikey_' || requester::text || '_';

  expected_prefix := requester_prefix;

  suffix := substring(secret_name from length(expected_prefix) + 1);

  if not exists (
    select 1
    from public.api_keys
    where vault_secret_name = secret_name
      and user_id = requester
  )
  and left(secret_name, length(expected_prefix)) <> expected_prefix then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'ownership check failed');
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if suffix !~ '^[a-z]+_[0-9]+$' then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'invalid suffix format');
    raise exception 'Invalid secret name format'
      using errcode = '22023';
  end if;

  delete from vault.secrets
  where name = secret_name;

  if not found then
    insert into public.vault_secret_audit (user_id, secret_name, action, details)
    values (requester, secret_name, 'attempt_denied', 'secret not found');
    raise exception 'Secret not found'
      using errcode = 'P0002';
  end if;

  insert into public.vault_secret_audit (user_id, secret_name, action, details)
  values (requester, secret_name, 'delete', null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_secret(secret_name text, requester uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_chat_generation_job_user_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  active_limit constant integer := 3;
  active_count integer;
begin
  if new.status not in ('pending', 'processing') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chat_generation_jobs:' || new.user_id::text, 0));

  select count(*)
    into active_count
  from public.chat_generation_jobs
  where user_id = new.user_id
    and status in ('pending', 'processing');

  if active_count >= active_limit then
    raise exception using
      errcode = 'P0001',
      message = format('User already has %s active chat generation jobs', active_limit),
      detail = 'Wait for an existing response to finish before queueing another.';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_character_asset_url(asset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  storage_path_val text;
  bucket_name text := 'character-assets';
BEGIN
  SELECT storage_path INTO storage_path_val
  FROM public.character_assets
  WHERE id = asset_id;

  IF storage_path_val IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN current_setting('app.settings.supabase_url', true)
    || '/storage/v1/object/public/'
    || bucket_name
    || '/'
    || storage_path_val;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_character_assets(p_character_id uuid)
 RETURNS TABLE(id uuid, asset_type text, file_name text, display_name text, public_url text, content_type text, file_size integer, metadata jsonb, display_order integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    ca.id,
    ca.asset_type,
    ca.file_name,
    ca.display_name,
    public.get_character_asset_url(ca.id) AS public_url,
    ca.content_type,
    ca.file_size,
    ca.metadata,
    ca.display_order
  FROM public.character_assets ca
  WHERE ca.character_id = p_character_id
  ORDER BY ca.asset_type, ca.display_order, ca.file_name;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_token_totals(p_chat_id uuid, p_requester uuid)
 RETURNS TABLE(prompt_tokens bigint, completion_tokens bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
      from public.chats c
     where c.id = p_chat_id
       and c.user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(m.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(m.completion_tokens), 0)::bigint as completion_tokens
    from public.messages m
   where m.chat_id = p_chat_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_usage_costs(p_chat_id uuid, p_requester uuid)
 RETURNS TABLE(prompt_tokens bigint, completion_tokens bigint, cached_input_tokens bigint, reasoning_tokens bigint, prompt_cost_usd double precision, completion_cost_usd double precision, cached_input_cost_usd double precision, reasoning_cost_usd double precision, total_cost_usd double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
      from public.chats c
     where c.id = p_chat_id
       and c.user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(e.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(e.completion_tokens), 0)::bigint as completion_tokens,
      coalesce(sum(e.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(e.reasoning_tokens), 0)::bigint as reasoning_tokens,
      coalesce(sum(e.prompt_cost_usd), 0)::double precision as prompt_cost_usd,
      coalesce(sum(e.completion_cost_usd), 0)::double precision as completion_cost_usd,
      coalesce(sum(e.cached_input_cost_usd), 0)::double precision as cached_input_cost_usd,
      coalesce(sum(e.reasoning_cost_usd), 0)::double precision as reasoning_cost_usd,
      coalesce(sum(e.total_cost_usd), 0)::double precision as total_cost_usd
    from public.chat_usage_events e
   where e.chat_id = p_chat_id
     and e.user_id = p_requester;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_decrypted_secret(secret_name text, requester uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  effective_requester uuid;
  secret_value text;
BEGIN
  effective_requester := coalesce(requester, auth.uid());

  IF effective_requester IS NULL THEN
    RAISE EXCEPTION 'Not authorized'
      USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.api_keys
    WHERE vault_secret_name = secret_name
      AND user_id = effective_requester
  ) THEN
    RAISE EXCEPTION 'Not authorized'
      USING errcode = '42501';
  END IF;

  SELECT decrypted_secret
    INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name = secret_name;

  IF secret_value IS NULL THEN
    RAISE EXCEPTION 'Secret not found'
      USING errcode = 'P0002';
  END IF;

  RETURN secret_value;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.match_chat_facts(chat_id uuid, target_user_id uuid, query_embedding public.vector, match_threshold double precision, match_count integer)
 RETURNS TABLE(start_seq integer, end_seq integer, facts text, similarity double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  requester uuid := auth.uid();
  effective_user uuid := target_user_id;
begin
  if requester is not null then
    if effective_user is null then
      effective_user := requester;
    elsif effective_user <> requester then
      raise exception 'Forbidden'
        using errcode = '42501';
    end if;
  end if;

  if effective_user is null then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chats c
    where c.id = match_chat_facts.chat_id
      and c.user_id = effective_user
  ) then
    raise exception 'Forbidden'
      using errcode = '42501';
  end if;

  return query
  select
    cf.start_seq,
    cf.end_seq,
    cf.facts,
    1 - (cf.embedding <=> query_embedding) as similarity
  from public.chat_facts cf
  where
    cf.chat_id = match_chat_facts.chat_id
    and cf.user_id = effective_user
    and cf.embedding is not null
    and 1 - (cf.embedding <=> query_embedding) > match_threshold
  order by cf.embedding <=> query_embedding
  limit match_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_charx_import_job_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_chat_summary_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_message_user_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_risum_import_job_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_lorebook_overrides_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_lorebook_overrides_v2_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_personas_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
