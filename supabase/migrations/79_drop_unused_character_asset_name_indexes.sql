-- character_assets name matching currently happens after loading the asset list
-- into application memory. These historical name indexes have shown no usage
-- in the current observation window and duplicate write/storage overhead.

drop index if exists public.idx_character_assets_display_name;
drop index if exists public.idx_character_assets_canonical_name;
