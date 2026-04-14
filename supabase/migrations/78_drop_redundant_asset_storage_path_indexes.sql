-- character_assets.storage_path and module_assets.storage_path already have
-- unique constraints backed by btree indexes. The extra non-unique indexes on
-- the same column duplicate storage and write-maintenance cost without adding
-- a different access path.

drop index if exists public.idx_character_assets_storage_path;
drop index if exists public.idx_module_assets_storage_path;
