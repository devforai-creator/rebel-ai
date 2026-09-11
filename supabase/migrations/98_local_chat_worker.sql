-- Cloud and trusted desktop workers have disjoint atomic claim paths.
create table public.local_chat_worker_status (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.local_chat_worker_status enable row level security;
revoke all on public.local_chat_worker_status from public, anon, authenticated;
grant all on public.local_chat_worker_status to service_role;

create or replace function public.claim_pending_chat_job()
returns table(id uuid, payload jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  with next_job as (
    select j.id from public.chat_generation_jobs j
    where j.status = 'pending'
      and coalesce(j.payload ->> 'provider', '') <> 'local'
      and not exists (
        select 1 from public.api_keys k
        where k.id::text = j.payload ->> 'apiKeyId' and k.provider = 'local'
      )
    order by j.created_at for update skip locked limit 1
  ), claimed as (
    update public.chat_generation_jobs j set status='processing',
      lifecycle_stage='runner_claimed', failure_stage=null, error=null
    from next_job n where j.id=n.id returning j.id,j.payload
  ) select claimed.id,claimed.payload from claimed;
end;
$$;

create function public.claim_pending_local_chat_job(p_owner uuid)
returns table(id uuid, payload jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_owner is null then raise exception 'Owner required'; end if;
  -- Serializes parallel claimers for this owner. Never retry a processing job.
  perform pg_advisory_xact_lock(hashtextextended('local-chat-worker:' || p_owner::text,0));
  if exists (
    select 1 from public.chat_generation_jobs j
    where j.user_id=p_owner and j.status='processing' and j.payload->>'provider'='local'
  ) then return; end if;
  return query
  with next_job as (
    select j.id from public.chat_generation_jobs j
    where j.status='pending' and j.user_id=p_owner
      and j.payload->>'userId'=p_owner::text
      and j.payload->>'chatId'=j.chat_id::text
      and j.payload->>'provider'='local'
      and exists (
        select 1 from public.api_keys k where k.id::text=j.payload->>'apiKeyId'
        and k.user_id=p_owner and k.provider='local'
      )
    order by j.created_at for update skip locked limit 1
  ), claimed as (
    update public.chat_generation_jobs j set status='processing',
      lifecycle_stage='runner_claimed', failure_stage=null, error=null
    from next_job n where j.id=n.id returning j.id,j.payload
  ) select claimed.id,claimed.payload from claimed;
end;
$$;
revoke all on function public.claim_pending_chat_job() from public,anon,authenticated;
revoke all on function public.claim_pending_local_chat_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_pending_chat_job() to service_role;
grant execute on function public.claim_pending_local_chat_job(uuid) to service_role;
