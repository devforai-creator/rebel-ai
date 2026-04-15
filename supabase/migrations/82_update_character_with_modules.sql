-- Update a character and replace its module links inside one transaction.
-- This prevents partial relink failures from clearing the existing link set.

create or replace function public.update_character_with_modules(
  p_character_id uuid,
  p_name text,
  p_description text,
  p_system_prompt text,
  p_greeting_message text,
  p_module_ids uuid[] default '{}'::uuid[],
  p_requester uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(p_requester, caller_uid);
  normalized_module_ids uuid[] := '{}'::uuid[];
  requested_module_count integer := 0;
  owned_module_count integer := 0;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role <> 'service_role' and effective_requester <> caller_uid then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  perform 1
  from public.characters
  where id = p_character_id
    and user_id = effective_requester
  for update;

  if not found then
    raise exception 'Character not found'
      using errcode = 'P0002';
  end if;

  with requested_modules as (
    select requested.module_id, min(requested.ordinality) as first_position
    from unnest(coalesce(p_module_ids, '{}'::uuid[])) with ordinality as requested(module_id, ordinality)
    where requested.module_id is not null
    group by requested.module_id
  )
  select coalesce(array_agg(module_id order by first_position), '{}'::uuid[]),
         count(*)::integer
    into normalized_module_ids, requested_module_count
  from requested_modules;

  if requested_module_count > 0 then
    select count(*)::integer
      into owned_module_count
    from public.modules
    where user_id = effective_requester
      and id = any(normalized_module_ids);

    if owned_module_count <> requested_module_count then
      raise exception 'Selected modules not found or not owned by requester'
        using errcode = '42501';
    end if;
  end if;

  update public.characters
  set name = p_name,
      description = p_description,
      system_prompt = p_system_prompt,
      greeting_message = p_greeting_message
  where id = p_character_id
    and user_id = effective_requester;

  delete from public.character_modules
  where character_id = p_character_id;

  insert into public.character_modules (character_id, module_id, enabled, priority)
  select p_character_id,
         requested.module_id,
         true,
         (cardinality(normalized_module_ids) - requested.ordinality + 1)
  from unnest(normalized_module_ids) with ordinality as requested(module_id, ordinality);
end;
$$;

revoke all on function public.update_character_with_modules(uuid, text, text, text, text, uuid[], uuid) from public, anon;
grant execute on function public.update_character_with_modules(uuid, text, text, text, text, uuid[], uuid) to authenticated, service_role;
