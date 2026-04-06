-- Indexes for stuck-job janitor scans.
-- These queries always filter processing jobs by updated_at cutoff, so use
-- partial indexes that stay small and hot.

create index if not exists chat_generation_jobs_processing_updated_at_idx
  on public.chat_generation_jobs (updated_at)
  where status = 'processing';

create index if not exists charx_import_jobs_processing_updated_at_idx
  on public.charx_import_jobs (updated_at)
  where status = 'processing';
