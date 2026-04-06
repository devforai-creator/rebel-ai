-- ============================================
-- Add canonical_name column to character_assets
-- Stores the human-readable asset name for {{assetlist}} template
-- ============================================

-- Add canonical_name column
ALTER TABLE character_assets
ADD COLUMN IF NOT EXISTS canonical_name text;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_character_assets_canonical_name
ON character_assets(character_id, canonical_name)
WHERE canonical_name IS NOT NULL;

-- Backfill canonical_name from display_name for existing assets
-- Extract just the filename without path prefixes
UPDATE character_assets
SET canonical_name = (
  CASE
    -- Skip if display_name is NULL or empty
    WHEN display_name IS NULL OR display_name = '' THEN NULL
    -- Skip pure numeric filenames (e.g., "1055", "2.webp")
    WHEN display_name ~ '^\d+(\.\w+)?$' THEN NULL
    WHEN (regexp_replace(display_name, '^.*/([^/]+)$', '\1')) ~ '^\d+(\.\w+)?$' THEN NULL
    -- Extract filename from path and remove extension
    ELSE regexp_replace(
      regexp_replace(
        -- Remove path prefix (get last segment after /)
        CASE
          WHEN display_name LIKE '%/%' THEN regexp_replace(display_name, '^.*/([^/]+)$', '\1')
          ELSE display_name
        END,
        -- Remove file extension
        '\.(jpeg|jpg|png|gif|webp)$', '', 'i'
      ),
      -- Remove trailing underscores/spaces
      '[_\s]+$', '', 'g'
    )
  END
)
WHERE canonical_name IS NULL;

-- Comment for documentation
COMMENT ON COLUMN character_assets.canonical_name IS
'Human-readable asset name for {{assetlist}} template. Extracted from display_name at import time, without path prefixes or extensions.';
