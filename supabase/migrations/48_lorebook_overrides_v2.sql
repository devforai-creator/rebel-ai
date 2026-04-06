-- ============================================================================
-- Lorebook Overrides v2
-- Fixes ambiguity when multiple modules contain entries with the same
-- (entry_key, entry_insertorder) by adding module_id + entry_fingerprint.
-- ============================================================================

CREATE TABLE IF NOT EXISTS lorebook_overrides_v2 (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- References
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE NOT NULL,

  -- Lorebook entry identification
  entry_key text NOT NULL,
  entry_insertorder integer NOT NULL,
  entry_fingerprint text NOT NULL,

  -- User preference
  enabled boolean NOT NULL,

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Ensure one override per entry per chat
  UNIQUE(chat_id, module_id, entry_fingerprint)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_v2_chat_id
  ON lorebook_overrides_v2(chat_id);
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_v2_user_id
  ON lorebook_overrides_v2(user_id);

-- RLS Policies
ALTER TABLE lorebook_overrides_v2 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lorebook overrides v2"
  ON lorebook_overrides_v2
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_lorebook_overrides_v2_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lorebook_overrides_v2_updated_at
  BEFORE UPDATE ON lorebook_overrides_v2
  FOR EACH ROW
  EXECUTE FUNCTION update_lorebook_overrides_v2_updated_at();

-- Comments
COMMENT ON TABLE lorebook_overrides_v2 IS 'Per-chat overrides for lorebook entry activation (v2: includes module_id + fingerprint)';
COMMENT ON COLUMN lorebook_overrides_v2.module_id IS 'Source module for the entry';
COMMENT ON COLUMN lorebook_overrides_v2.entry_fingerprint IS 'Stable fingerprint for disambiguating duplicate (key, insertorder) entries';

