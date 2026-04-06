-- ============================================================================
-- Migration 34: Fix ambiguous column reference in match_chat_facts
-- ============================================================================

create or replace function public.match_chat_facts(
  chat_id uuid,
  target_user_id uuid,
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
returns table (
  start_seq int,
  end_seq int,
  facts text,
  similarity float
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
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
$$;
