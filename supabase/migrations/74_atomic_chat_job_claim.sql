-- Atomically claim the next pending chat generation job for the runner.

create index if not exists chat_generation_jobs_pending_created_idx
  on public.chat_generation_jobs (created_at)
  where status = 'pending';

create or replace function public.claim_pending_chat_job()
returns table (
  id uuid,
  payload jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
  with next_job as (
    select job.id
    from public.chat_generation_jobs job
    where job.status = 'pending'
    order by job.created_at asc
    for update skip locked
    limit 1
  ),
  claimed as (
    update public.chat_generation_jobs job
    set status = 'processing',
        lifecycle_stage = 'runner_claimed',
        failure_stage = null,
        error = null
    from next_job
    where job.id = next_job.id
    returning job.id, job.payload
  )
  select claimed.id, claimed.payload
  from claimed;
end;
$$;

revoke all on function public.claim_pending_chat_job() from public, anon, authenticated;
grant execute on function public.claim_pending_chat_job() to service_role;
