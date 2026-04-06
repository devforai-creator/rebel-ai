-- Queue admission controls for chat generation and RBX imports.
-- Goals:
-- 1. Only one active chat generation job per chat
-- 2. Cap each user to 3 active chat generation jobs
-- 3. Only one active RBX import job per user

create unique index if not exists chat_generation_jobs_active_chat_idx
  on public.chat_generation_jobs (chat_id)
  where status in ('pending', 'processing');

create index if not exists chat_generation_jobs_user_status_created_idx
  on public.chat_generation_jobs (user_id, status, created_at desc);

create or replace function public.enforce_chat_generation_job_user_cap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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
$$;

drop trigger if exists enforce_chat_generation_job_user_cap on public.chat_generation_jobs;

create trigger enforce_chat_generation_job_user_cap
before insert on public.chat_generation_jobs
for each row execute function public.enforce_chat_generation_job_user_cap();

create unique index if not exists charx_import_jobs_active_user_idx
  on public.charx_import_jobs (user_id)
  where status in ('pending', 'processing');
