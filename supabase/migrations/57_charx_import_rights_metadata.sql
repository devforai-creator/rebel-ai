-- =====================================================
-- CharX Import Job Rights Metadata
-- Tracks provenance + redistribution claims for CharX uploads
-- =====================================================

alter table if exists public.charx_import_jobs
  add column if not exists rights_status text not null default 'self_owned'
    check (rights_status in ('self_owned', 'third_party_with_license')),
  add column if not exists rights_attested boolean not null default false,
  add column if not exists license_type text,
  add column if not exists license_url text,
  add column if not exists license_notes text,
  add column if not exists source_url text,
  add column if not exists source_label text;

comment on column public.charx_import_jobs.rights_status is 'self_owned = uploaded by owner, third_party_with_license = imported under an allowed, documented license';
comment on column public.charx_import_jobs.rights_attested is 'Whether the uploader explicitly confirmed their rights to redistribute the CharX file';
comment on column public.charx_import_jobs.license_type is 'Declared license for the CharX payload (e.g., CC BY 4.0)';
comment on column public.charx_import_jobs.license_url is 'Link to the license text or proof';
comment on column public.charx_import_jobs.license_notes is 'Free-form notes about the license or attribution requirements';
comment on column public.charx_import_jobs.source_url is 'Original source URL (e.g., RisuRealm share link)';
comment on column public.charx_import_jobs.source_label is 'Human friendly label for the source (uploader name/site)';
