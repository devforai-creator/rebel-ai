-- ============================================================================
-- Simulation Characters Support
-- ============================================================================
-- This migration adds support for multi-character simulation scenarios
-- like "Alternate Hunters" (CharX v3 spec)
--
-- Changes:
--   1. Extend characters.metadata for simulation-type characters
--   2. Create character_assets table for per-character image assets
--   3. Add helper function for asset URL generation
-- ============================================================================

-- ============================================================================
-- 1. Extend Characters Metadata
-- ============================================================================
-- Add documentation for new metadata fields used by simulation characters
-- Note: JSONB columns don't need schema changes, just documentation

COMMENT ON COLUMN characters.metadata IS 'Character metadata (JSONB)
  Common fields:
    - type: "single" | "simulation" (default: "single")
    - imported_from: "charx_v1" | "charx_v2" | "charx_v3" | "tavern_png"

  Simulation-specific fields (type="simulation"):
    - character_list: string[] - List of NPC names in simulation
    - image_commands: {[name: string]: asset_id} - NPC name → asset ID mapping
    - alternate_greetings: string[] - Additional starting scenarios
    - post_history_instructions: string - Instructions for AI (image commands, etc)
    - charx_version: string - CharX spec version ("3.0", etc)
    - language_templates: object - Multi-language template variables
      - lang: string - Current language code
      - variables: {[key: string]: any} - Template variables';

-- ============================================================================
-- 2. Character Assets Table
-- ============================================================================
-- Stores per-character image assets (avatars, NPC images, backgrounds)
-- Different from modules.assets (which are module-level, not character-level)

CREATE TABLE IF NOT EXISTS character_assets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id uuid REFERENCES characters(id) ON DELETE CASCADE NOT NULL,

  -- Asset identification
  asset_type text NOT NULL,  -- 'icon' | 'character_image' | 'background' | 'other'
  file_name text NOT NULL,   -- Original filename from CharX

  -- Storage
  storage_path text NOT NULL UNIQUE,  -- Path in character-assets bucket
  content_type text,                  -- MIME type (image/png, image/webp, etc)
  file_size integer,                  -- File size in bytes

  -- Display & Organization
  display_name text,                  -- Display name (e.g., NPC name for character_image)
  display_order integer DEFAULT 0,    -- Sort order for UI listing

  -- Metadata from x_meta (NovelAI generation info, etc)
  metadata jsonb DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX idx_character_assets_character_id ON character_assets(character_id);
CREATE INDEX idx_character_assets_type ON character_assets(character_id, asset_type);
CREATE INDEX idx_character_assets_display_name ON character_assets(character_id, display_name);
CREATE INDEX idx_character_assets_storage_path ON character_assets(storage_path);

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE character_assets ENABLE ROW LEVEL SECURITY;

-- Users can view assets of their own characters
CREATE POLICY "Users can view own character assets"
  ON character_assets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- Users can insert assets for their own characters
CREATE POLICY "Users can insert own character assets"
  ON character_assets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- Users can update assets of their own characters
CREATE POLICY "Users can update own character assets"
  ON character_assets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- Users can delete assets of their own characters
CREATE POLICY "Users can delete own character assets"
  ON character_assets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_assets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE TRIGGER update_character_assets_updated_at
  BEFORE UPDATE ON character_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Generate public URL for character asset
-- Usage: SELECT get_character_asset_url(asset_id);
CREATE OR REPLACE FUNCTION get_character_asset_url(asset_id uuid)
RETURNS text AS $$
DECLARE
  storage_path_val text;
  bucket_name text := 'character-assets';
BEGIN
  SELECT storage_path INTO storage_path_val
  FROM character_assets
  WHERE id = asset_id;

  IF storage_path_val IS NULL THEN
    RETURN NULL;
  END IF;

  -- Return Supabase Storage public URL
  -- Format: https://<project_ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
  RETURN current_setting('app.settings.supabase_url', true)
    || '/storage/v1/object/public/'
    || bucket_name
    || '/'
    || storage_path_val;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get all assets for a character (grouped by type)
-- Usage: SELECT * FROM get_character_assets('character-uuid');
CREATE OR REPLACE FUNCTION get_character_assets(p_character_id uuid)
RETURNS TABLE (
  id uuid,
  asset_type text,
  file_name text,
  display_name text,
  public_url text,
  content_type text,
  file_size integer,
  metadata jsonb,
  display_order integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.id,
    ca.asset_type,
    ca.file_name,
    ca.display_name,
    get_character_asset_url(ca.id) as public_url,
    ca.content_type,
    ca.file_size,
    ca.metadata,
    ca.display_order
  FROM character_assets ca
  WHERE ca.character_id = p_character_id
  ORDER BY ca.asset_type, ca.display_order, ca.file_name;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE character_assets IS 'Per-character image assets (avatars, NPC images, backgrounds)';
COMMENT ON COLUMN character_assets.asset_type IS 'Asset category: icon, character_image, background, other';
COMMENT ON COLUMN character_assets.storage_path IS 'Path in character-assets Supabase Storage bucket';
COMMENT ON COLUMN character_assets.metadata IS 'Asset metadata (NovelAI generation info, etc)';
COMMENT ON COLUMN character_assets.display_name IS 'Display name (e.g., NPC name for character images)';

COMMENT ON FUNCTION get_character_asset_url IS 'Generate public URL for character asset by ID';
COMMENT ON FUNCTION get_character_assets IS 'Get all assets for a character with public URLs';

-- ============================================================================
-- Migration Complete!
-- ============================================================================
