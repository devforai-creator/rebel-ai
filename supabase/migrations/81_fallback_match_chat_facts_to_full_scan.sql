-- Keep the recent-candidate fast path, but fall back to the full chat scan
-- when the recent window produces no matches above threshold.

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
  candidate_limit integer := greatest(match_count * 100, 1000);
  recent_match_count bigint := 0;
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
  with recent_candidates as (
    select
      cf.start_seq,
      cf.end_seq,
      cf.facts,
      cf.embedding
    from public.chat_facts cf
    where
      cf.chat_id = match_chat_facts.chat_id
      and cf.user_id = effective_user
      and cf.embedding is not null
    order by cf.start_seq desc
    limit candidate_limit
  )
  select
    recent_candidates.start_seq,
    recent_candidates.end_seq,
    recent_candidates.facts,
    1 - (recent_candidates.embedding <=> query_embedding) as similarity
  from recent_candidates
  where 1 - (recent_candidates.embedding <=> query_embedding) > match_threshold
  order by recent_candidates.embedding <=> query_embedding
  limit match_count;

  get diagnostics recent_match_count = row_count;
  if recent_match_count > 0 then
    return;
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
