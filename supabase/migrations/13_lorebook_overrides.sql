-- ============================================================================
-- Lorebook Overrides
-- Allows users to enable/disable specific lorebook entries per chat
-- ============================================================================

-- Lorebook entry overrides per chat
-- Stores user preferences for which lorebook entries to activate
-- Default behavior: Use module's lorebook settings
-- Override behavior: Use user's explicit enable/disable preference
CREATE TABLE IF NOT EXISTS lorebook_overrides (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- References
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Lorebook entry identification
  -- We use key + insertorder to uniquely identify an entry
  entry_key text NOT NULL,
  entry_insertorder integer NOT NULL,

  -- User preference
  enabled boolean NOT NULL,

  -- Metadata
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Ensure one override per entry per chat
  UNIQUE(chat_id, entry_key, entry_insertorder)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_chat_id
  ON lorebook_overrides(chat_id);
CREATE INDEX IF NOT EXISTS idx_lorebook_overrides_user_id
  ON lorebook_overrides(user_id);

-- RLS Policies
ALTER TABLE lorebook_overrides ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own overrides
CREATE POLICY "Users can view their own lorebook overrides"
  ON lorebook_overrides
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lorebook overrides"
  ON lorebook_overrides
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lorebook overrides"
  ON lorebook_overrides
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lorebook overrides"
  ON lorebook_overrides
  FOR DELETE
  USING (auth.uid() = user_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_lorebook_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lorebook_overrides_updated_at
  BEFORE UPDATE ON lorebook_overrides
  FOR EACH ROW
  EXECUTE FUNCTION update_lorebook_overrides_updated_at();

-- Comments
COMMENT ON TABLE lorebook_overrides IS 'Per-chat overrides for lorebook entry activation';
COMMENT ON COLUMN lorebook_overrides.entry_key IS 'Lorebook entry key (keywords)';
COMMENT ON COLUMN lorebook_overrides.entry_insertorder IS 'Lorebook entry insertorder for uniqueness';
COMMENT ON COLUMN lorebook_overrides.enabled IS 'User preference: true = force enable, false = force disable';
