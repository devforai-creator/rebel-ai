-- Add delivery-mode tracking for Anthropic Message Batches chat jobs.

alter table public.chat_generation_jobs
  add column if not exists delivery_mode text not null default 'streaming'
    check (delivery_mode in ('streaming', 'anthropic_batch')),
  add column if not exists external_provider_job_id text,
  add column if not exists external_provider_status text,
  add column if not exists external_provider_submitted_at timestamptz,
  add column if not exists external_provider_last_checked_at timestamptz,
  add column if not exists external_provider_result_url text,
  add column if not exists external_provider_metadata jsonb;

comment on column public.chat_generation_jobs.delivery_mode is
  'Execution mode for the job (streaming | anthropic_batch).';

comment on column public.chat_generation_jobs.external_provider_job_id is
  'Provider-side async job id, such as an Anthropic message batch id.';

create index if not exists chat_generation_jobs_anthropic_batch_processing_idx
  on public.chat_generation_jobs (external_provider_last_checked_at, created_at)
  where delivery_mode = 'anthropic_batch'
    and status = 'processing'
    and external_provider_job_id is not null;
