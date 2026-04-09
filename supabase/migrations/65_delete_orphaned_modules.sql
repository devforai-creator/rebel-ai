-- Delete user-owned modules that are no longer linked to any character.
-- This is used after character edits/deletes so imported modules do not linger
-- as orphaned rows when their final character link is removed.

create or replace function public.delete_orphaned_modules(
  module_ids uuid[],
  requester uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_uid uuid := auth.uid();
  caller_role text := auth.role();
  effective_requester uuid := coalesce(requester, caller_uid);
  deleted_count integer := 0;
begin
  if effective_requester is null then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if caller_role <> 'service_role' and effective_requester <> caller_uid then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if coalesce(array_length(module_ids, 1), 0) = 0 then
    return 0;
  end if;

  with candidate_modules as (
    select distinct candidate.module_id
    from unnest(module_ids) as candidate(module_id)
    where candidate.module_id is not null
  ),
  deleted as (
    delete from public.modules m
    using candidate_modules c
    where m.id = c.module_id
      and m.user_id = effective_requester
      and not exists (
        select 1
        from public.character_modules cm
        where cm.module_id = m.id
      )
    returning 1
  )
  select count(*)::integer
    into deleted_count
  from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.delete_orphaned_modules(uuid[], uuid) from public, anon;
grant execute on function public.delete_orphaned_modules(uuid[], uuid) to authenticated, service_role;

delete from public.modules m
where not exists (
  select 1
  from public.character_modules cm
  where cm.module_id = m.id
);
