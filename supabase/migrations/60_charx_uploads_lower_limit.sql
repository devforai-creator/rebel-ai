-- Lower charx-uploads bucket limit to match the conservative app default.
-- Previous value was 800 MiB (migration 50) to support large .risum modules.
-- Application now enforces a tighter default (100 MB) with env-configurable
-- override, so the bucket acts as a last-resort backstop at 200 MiB.
-- Self-hosters who raise IMPORT_MAX_UPLOAD_MB above 200 should also raise
-- this bucket limit manually in Supabase Dashboard → Storage → charx-uploads.
update storage.buckets
set file_size_limit = 209715200 -- 200 MiB
where id = 'charx-uploads';
