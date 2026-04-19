-- Local-only RAG retrieval benchmark for `match_chat_facts`.
--
-- Usage:
--   npm run benchmark:rag:retrieval
--
-- The script:
--   1. seeds a small fixture (200 facts in one chat),
--   2. prints the inner query plan and function wrapper plan,
--   3. rolls everything back,
--   4. seeds a large fixture (5,000 target-chat facts + 15,000 sibling-chat facts),
--   5. prints the same two plans,
--   6. rolls everything back again.
--
-- No benchmark data is left behind after the run.

\set benchmark_candidate_limit 1000

create or replace function pg_temp.make_unit_vector(active_index integer)
returns vector(1024)
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  if active_index < 1 or active_index > 1024 then
    raise exception 'active_index out of range: %', active_index;
  end if;

  parts := array_fill('0'::text, array[1024]);
  parts[active_index] := '1';

  return format('[%s]', array_to_string(parts, ','))::vector(1024);
end;
$$;

create or replace function pg_temp.seed_benchmark_identity(
  benchmark_user_id uuid,
  benchmark_character_id uuid
)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    id,
    email,
    aud,
    role,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    benchmark_user_id,
    'rag-benchmark@example.com',
    'authenticated',
    'authenticated',
    '$2a$10$abcdefghijklmnopqrstuv',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"RAG Benchmark"}'::jsonb,
    now(),
    now()
  );

  insert into public.characters (
    id,
    user_id,
    name,
    system_prompt
  )
  values (
    benchmark_character_id,
    benchmark_user_id,
    'RAG Benchmark Character',
    'Benchmark-only character prompt.'
  );
end;
$$;

create or replace function pg_temp.seed_benchmark_chat(
  benchmark_chat_id uuid,
  benchmark_user_id uuid,
  benchmark_character_id uuid,
  benchmark_title text
)
returns void
language plpgsql
as $$
begin
  insert into public.chats (
    id,
    user_id,
    character_id,
    title
  )
  values (
    benchmark_chat_id,
    benchmark_user_id,
    benchmark_character_id,
    benchmark_title
  );
end;
$$;

select 'small_fixture_start' as benchmark_step;

begin;

select pg_temp.seed_benchmark_identity(
  '00000000-0000-4000-8000-00000000aa10',
  '00000000-0000-4000-8000-00000000aa11'
);

select pg_temp.seed_benchmark_chat(
  '00000000-0000-4000-8000-00000000aa12',
  '00000000-0000-4000-8000-00000000aa10',
  '00000000-0000-4000-8000-00000000aa11',
  'RAG benchmark small chat'
);

insert into public.chat_facts (
  chat_id,
  user_id,
  start_seq,
  end_seq,
  facts,
  embedding
)
select
  '00000000-0000-4000-8000-00000000aa12'::uuid,
  '00000000-0000-4000-8000-00000000aa10'::uuid,
  seq_no,
  seq_no,
  format('small benchmark fact %s', seq_no),
  pg_temp.make_unit_vector(1)
from generate_series(1, 200) as seq_no;

analyze public.chats;
analyze public.chat_facts;

select
  'small_fixture_counts' as benchmark_step,
  count(*) as fact_rows
from public.chat_facts
where chat_id = '00000000-0000-4000-8000-00000000aa12'::uuid;

select 'small_inner_query_plan' as benchmark_step;

explain (analyze, buffers)
with recent_candidates as (
  select
    cf.start_seq,
    cf.end_seq,
    cf.facts,
    cf.embedding
  from public.chat_facts cf
  where
    cf.chat_id = '00000000-0000-4000-8000-00000000aa12'::uuid
    and cf.user_id = '00000000-0000-4000-8000-00000000aa10'::uuid
    and cf.embedding is not null
  order by cf.start_seq desc
  limit :benchmark_candidate_limit
)
select
  recent_candidates.start_seq,
  recent_candidates.end_seq,
  recent_candidates.facts,
  1 - (recent_candidates.embedding <=> ctx.query_embedding) as similarity
from recent_candidates
cross join (
  select pg_temp.make_unit_vector(1) as query_embedding
) ctx
where 1 - (recent_candidates.embedding <=> ctx.query_embedding) > 0.6
order by recent_candidates.embedding <=> ctx.query_embedding
limit 5;

select 'small_wrapper_query_plan' as benchmark_step;

explain (analyze, buffers)
select *
from public.match_chat_facts(
  '00000000-0000-4000-8000-00000000aa12'::uuid,
  '00000000-0000-4000-8000-00000000aa10'::uuid,
  pg_temp.make_unit_vector(1),
  0.6,
  5
);

rollback;

select 'large_fixture_start' as benchmark_step;

begin;

select pg_temp.seed_benchmark_identity(
  '00000000-0000-4000-8000-00000000bb10',
  '00000000-0000-4000-8000-00000000bb11'
);

select pg_temp.seed_benchmark_chat(
  '00000000-0000-4000-8000-00000000bb12',
  '00000000-0000-4000-8000-00000000bb10',
  '00000000-0000-4000-8000-00000000bb11',
  'RAG benchmark large target chat'
);

select pg_temp.seed_benchmark_chat(
  '00000000-0000-4000-8000-00000000bb13',
  '00000000-0000-4000-8000-00000000bb10',
  '00000000-0000-4000-8000-00000000bb11',
  'RAG benchmark sibling chat'
);

insert into public.chat_facts (
  chat_id,
  user_id,
  start_seq,
  end_seq,
  facts,
  embedding
)
select
  '00000000-0000-4000-8000-00000000bb12'::uuid,
  '00000000-0000-4000-8000-00000000bb10'::uuid,
  seq_no,
  seq_no,
  format('large target benchmark fact %s', seq_no),
  pg_temp.make_unit_vector(1)
from generate_series(1, 5000) as seq_no;

insert into public.chat_facts (
  chat_id,
  user_id,
  start_seq,
  end_seq,
  facts,
  embedding
)
select
  '00000000-0000-4000-8000-00000000bb13'::uuid,
  '00000000-0000-4000-8000-00000000bb10'::uuid,
  seq_no,
  seq_no,
  format('large sibling benchmark fact %s', seq_no),
  pg_temp.make_unit_vector(2)
from generate_series(1, 15000) as seq_no;

analyze public.chats;
analyze public.chat_facts;

select
  'large_fixture_counts' as benchmark_step,
  count(*) filter (where chat_id = '00000000-0000-4000-8000-00000000bb12'::uuid) as target_chat_rows,
  count(*) filter (where chat_id = '00000000-0000-4000-8000-00000000bb13'::uuid) as sibling_chat_rows
from public.chat_facts
where chat_id in (
  '00000000-0000-4000-8000-00000000bb12'::uuid,
  '00000000-0000-4000-8000-00000000bb13'::uuid
);

select 'large_inner_query_plan' as benchmark_step;

explain (analyze, buffers)
with recent_candidates as (
  select
    cf.start_seq,
    cf.end_seq,
    cf.facts,
    cf.embedding
  from public.chat_facts cf
  where
    cf.chat_id = '00000000-0000-4000-8000-00000000bb12'::uuid
    and cf.user_id = '00000000-0000-4000-8000-00000000bb10'::uuid
    and cf.embedding is not null
  order by cf.start_seq desc
  limit :benchmark_candidate_limit
)
select
  recent_candidates.start_seq,
  recent_candidates.end_seq,
  recent_candidates.facts,
  1 - (recent_candidates.embedding <=> ctx.query_embedding) as similarity
from recent_candidates
cross join (
  select pg_temp.make_unit_vector(1) as query_embedding
) ctx
where 1 - (recent_candidates.embedding <=> ctx.query_embedding) > 0.6
order by recent_candidates.embedding <=> ctx.query_embedding
limit 5;

select 'large_wrapper_query_plan' as benchmark_step;

explain (analyze, buffers)
select *
from public.match_chat_facts(
  '00000000-0000-4000-8000-00000000bb12'::uuid,
  '00000000-0000-4000-8000-00000000bb10'::uuid,
  pg_temp.make_unit_vector(1),
  0.6,
  5
);

rollback;

select 'quality_fallback_fixture_start' as benchmark_step;

begin;

select pg_temp.seed_benchmark_identity(
  '00000000-0000-4000-8000-00000000cc10',
  '00000000-0000-4000-8000-00000000cc11'
);

select pg_temp.seed_benchmark_chat(
  '00000000-0000-4000-8000-00000000cc12',
  '00000000-0000-4000-8000-00000000cc10',
  '00000000-0000-4000-8000-00000000cc11',
  'RAG benchmark fallback quality chat'
);

insert into public.chat_facts (
  chat_id,
  user_id,
  start_seq,
  end_seq,
  facts,
  embedding
)
values (
  '00000000-0000-4000-8000-00000000cc12'::uuid,
  '00000000-0000-4000-8000-00000000cc10'::uuid,
  1,
  1,
  'older exact-match fact',
  pg_temp.make_unit_vector(1)
);

insert into public.chat_facts (
  chat_id,
  user_id,
  start_seq,
  end_seq,
  facts,
  embedding
)
select
  '00000000-0000-4000-8000-00000000cc12'::uuid,
  '00000000-0000-4000-8000-00000000cc10'::uuid,
  seq_no,
  seq_no,
  format('recent non-match fact %s', seq_no),
  pg_temp.make_unit_vector(2)
from generate_series(2, 1001) as seq_no;

analyze public.chats;
analyze public.chat_facts;

select
  'quality_fallback_results' as benchmark_step,
  start_seq,
  end_seq,
  facts,
  round(similarity::numeric, 4) as similarity
from public.match_chat_facts(
  '00000000-0000-4000-8000-00000000cc12'::uuid,
  '00000000-0000-4000-8000-00000000cc10'::uuid,
  pg_temp.make_unit_vector(1),
  0.6,
  5
);

rollback;
