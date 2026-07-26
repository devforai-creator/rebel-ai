-- Remove legacy RPCs that expose public character asset URLs.
-- Character assets are private and are delivered through signed URLs.

drop function if exists public.get_character_assets(uuid);
drop function if exists public.get_character_asset_url(uuid);
