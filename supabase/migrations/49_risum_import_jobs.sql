-- =====================================================
-- RisuAI Module Import Job Queue (.risum)
-- Tracks background risum processing tasks
-- =====================================================

create table if not exists public.risum_import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  file_type text,
  rights_status text not null default 'self_owned'
    check (rights_status in ('self_owned', 'third_party_with_license')),
  rights_attested boolean not null default false,
  license_type text,
  license_url text,
  license_notes text,
  source_url text,
  source_label text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'success', 'error')),
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists risum_import_jobs_user_status_idx
  on public.risum_import_jobs (user_id, status, created_at desc);

create index if not exists risum_import_jobs_character_idx
  on public.risum_import_jobs (character_id, created_at desc);

alter table public.risum_import_jobs enable row level security;

create policy "Users can access their risum jobs"
  on public.risum_import_jobs
  for select
  using (auth.uid() = user_id);

create policy "Users can enqueue risum jobs"
  on public.risum_import_jobs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their risum jobs"
  on public.risum_import_jobs
  for update
  using (auth.uid() = user_id);

create policy "Users can delete their risum jobs"
  on public.risum_import_jobs
  for delete
  using (auth.uid() = user_id);

comment on column public.risum_import_jobs.rights_status is 'self_owned = uploaded by owner, third_party_with_license = imported under an allowed, documented license';
comment on column public.risum_import_jobs.rights_attested is 'Whether the uploader explicitly confirmed their rights to redistribute the risum file';
comment on column public.risum_import_jobs.license_type is 'Declared license for the risum payload (e.g., CC BY 4.0)';
comment on column public.risum_import_jobs.license_url is 'Link to the license text or proof';
comment on column public.risum_import_jobs.license_notes is 'Free-form notes about the license or attribution requirements';
comment on column public.risum_import_jobs.source_url is 'Original source URL (e.g., RisuRealm share link)';
comment on column public.risum_import_jobs.source_label is 'Human friendly label for the source (uploader name/site)';

create or replace function public.set_risum_import_job_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_risum_import_job_updated_at on public.risum_import_jobs;

create trigger set_risum_import_job_updated_at
before update on public.risum_import_jobs
for each row execute function public.set_risum_import_job_updated_at();
