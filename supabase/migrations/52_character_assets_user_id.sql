-- ============================================================================
-- Character Assets User ID Denormalization
-- ============================================================================
-- Performance fix: Add user_id directly to character_assets table
-- to avoid slow RLS policy with EXISTS subquery to characters table.
--
-- Problem: RLS policy "Users can view own character assets" does:
--   EXISTS (SELECT 1 FROM characters WHERE characters.id = character_assets.character_id AND characters.user_id = auth.uid())
-- This causes 1 subquery per row, which times out with many assets (733+ rows).
--
-- Solution: Denormalize user_id into character_assets for O(1) RLS check.
-- ============================================================================

-- 1. Add user_id column (nullable initially for migration)
ALTER TABLE character_assets
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Populate user_id from characters table
UPDATE character_assets
SET user_id = characters.user_id
FROM characters
WHERE character_assets.character_id = characters.id
AND character_assets.user_id IS NULL;

-- 3. Make user_id NOT NULL after population
ALTER TABLE character_assets
ALTER COLUMN user_id SET NOT NULL;

-- 4. Add index for RLS performance
CREATE INDEX IF NOT EXISTS idx_character_assets_user_id
ON character_assets(user_id);

-- 5. Drop old RLS policies
DROP POLICY IF EXISTS "Users can view own character assets" ON character_assets;
DROP POLICY IF EXISTS "Users can insert own character assets" ON character_assets;
DROP POLICY IF EXISTS "Users can update own character assets" ON character_assets;
DROP POLICY IF EXISTS "Users can delete own character assets" ON character_assets;

-- 6. Create new optimized RLS policies (direct user_id check, no subquery)
CREATE POLICY "Users can view own character assets"
  ON character_assets FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own character assets"
  ON character_assets FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own character assets"
  ON character_assets FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own character assets"
  ON character_assets FOR DELETE
  USING (user_id = auth.uid());

-- 7. Add comment documenting the denormalization
COMMENT ON COLUMN character_assets.user_id IS 'Denormalized from characters.user_id for RLS performance. Must match characters.user_id.';
