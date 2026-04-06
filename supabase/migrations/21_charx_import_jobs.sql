-- =====================================================
-- CharX Import Job Queue
-- Tracks background CharX processing tasks
-- =====================================================

create table if not exists public.charx_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  file_type text,
  preset_id uuid references public.presets(id) on delete set null,
  module_ids text[] default array[]::text[],
  status text not null default 'pending' check (status in ('pending', 'processing', 'success', 'error')),
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists charx_import_jobs_user_status_idx
  on public.charx_import_jobs (user_id, status, created_at desc);

alter table public.charx_import_jobs enable row level security;

create policy "Users can access their CharX jobs"
  on public.charx_import_jobs
  for select
  using (auth.uid() = user_id);

create policy "Users can enqueue CharX jobs"
  on public.charx_import_jobs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their CharX jobs"
  on public.charx_import_jobs
  for update
  using (auth.uid() = user_id);

create policy "Users can delete their CharX jobs"
  on public.charx_import_jobs
  for delete
  using (auth.uid() = user_id);

create or replace function public.set_charx_import_job_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_charx_import_job_updated_at on public.charx_import_jobs;

create trigger set_charx_import_job_updated_at
before update on public.charx_import_jobs
for each row execute function public.set_charx_import_job_updated_at();
