-- Persist last-known chat job lifecycle stage so operators can distinguish
-- queueing, runner pickup, provider request, batch wait/poll, streaming, and
-- post-processing failures from the same job record.

alter table public.chat_generation_jobs
  add column if not exists lifecycle_stage text not null default 'queued',
  add column if not exists failure_stage text;

comment on column public.chat_generation_jobs.lifecycle_stage is
  'Last known lifecycle stage for queued chat generation work (for example queued, runner_claimed, requesting_provider, post_processing, completed).';

comment on column public.chat_generation_jobs.failure_stage is
  'Lifecycle stage where the job most recently failed, or null when the current run has not failed.';

update public.chat_generation_jobs
set lifecycle_stage = case
      when status = 'pending' then 'queued'
      when status = 'processing' then 'runner_claimed'
      when status = 'success' then 'completed'
      when status = 'error' then coalesce(failure_stage, 'runner_claimed')
      else lifecycle_stage
    end,
    failure_stage = case
      when status = 'error' then coalesce(failure_stage, 'runner_claimed')
      else null
    end
where lifecycle_stage is null
   or lifecycle_stage = ''
   or (
     failure_stage is null
     and status = 'error'
   );
