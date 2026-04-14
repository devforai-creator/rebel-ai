-- ============================================================================
-- Private asset delivery
-- ============================================================================
-- Keep imported character/module assets private in storage.
-- Runtime access now goes through authenticated app routes that mint signed URLs.

update storage.buckets
set public = false
where id in ('character-assets', 'module-assets');

drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Module assets: public read access" on storage.objects;
