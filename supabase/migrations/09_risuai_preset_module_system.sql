-- ============================================================================
-- RisuAI Preset/Module System
-- ============================================================================
-- This migration adds support for RisuAI-compatible preset and module system
-- enabling template-based prompts with conditional logic and toggleable extensions.
--
-- Tables:
--   - presets: Store .risup preset files (template-based prompts)
--   - modules: Store .risum module files (toggleable extensions)
--   - character_presets: Link characters to presets
--   - character_modules: Link characters to modules (with priority)
--   - global_variables: Runtime state for template variables
-- ============================================================================

-- ============================================================================
-- Presets Table
-- ============================================================================
-- Stores RisuAI preset files (.risup)
-- Presets contain template-based prompts with conditional logic

CREATE TABLE IF NOT EXISTS presets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Basic info
  name text NOT NULL,
  description text,

  -- Template content (from risup promptTemplate field)
  -- Array of {type, text, role, name} objects
  prompt_template jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Model configuration
  config jsonb DEFAULT '{}'::jsonb,
  -- Example fields in config:
  --   temperature: number (0-200, stored as integer * 100)
  --   maxContext: number
  --   maxResponse: number
  --   frequencyPenalty: number
  --   presencePenalty: number
  --   formattingOrder: string[]
  --   apiModel: string
  --   bias: array of [token, weight]

  -- Metadata
  source_file text,  -- Original .risup filename
  risup_version integer DEFAULT 2,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_presets_user_id ON presets(user_id);
CREATE INDEX idx_presets_name ON presets(name);

-- RLS Policies
ALTER TABLE presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own presets"
  ON presets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own presets"
  ON presets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own presets"
  ON presets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own presets"
  ON presets FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Modules Table
-- ============================================================================
-- Stores RisuAI module files (.risum)
-- Modules provide toggleable extensions with lorebooks, regex, and scripts

CREATE TABLE IF NOT EXISTS modules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Basic info
  name text NOT NULL,
  description text,

  -- Toggle definitions (customModuleToggle from risum)
  -- These are the variables that this module sets when activated
  -- Example: {"use_chapters": true, "emotion_detail": "high"}
  toggle_definitions jsonb DEFAULT '{}'::jsonb,

  -- Module content
  lorebook jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: {key, content, comment, insertorder, alwaysActive, selective, etc}

  regex jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: {type: "editinput"|"editoutput", script, ...}

  triggers jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: {type: "start"|"manual"|"aftergen", script, ...}

  assets jsonb[] DEFAULT ARRAY[]::jsonb[],
  -- Each entry: [name, data, type]

  -- UI options
  hide_icon boolean DEFAULT false,

  -- Metadata
  source_file text,  -- Original .risum filename

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_modules_user_id ON modules(user_id);
CREATE INDEX idx_modules_name ON modules(name);

-- RLS Policies
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own modules"
  ON modules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own modules"
  ON modules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own modules"
  ON modules FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own modules"
  ON modules FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Character-Preset Relationship
-- ============================================================================
-- Links characters to presets (1:1 relationship for now)

CREATE TABLE IF NOT EXISTS character_presets (
  character_id uuid REFERENCES characters(id) ON DELETE CASCADE NOT NULL,
  preset_id uuid REFERENCES presets(id) ON DELETE CASCADE NOT NULL,

  -- Control
  active boolean DEFAULT true NOT NULL,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,

  PRIMARY KEY (character_id, preset_id)
);

-- Indexes
CREATE INDEX idx_character_presets_character ON character_presets(character_id);
CREATE INDEX idx_character_presets_preset ON character_presets(preset_id);
CREATE INDEX idx_character_presets_active ON character_presets(character_id, active);

-- RLS Policies
ALTER TABLE character_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own character presets"
  ON character_presets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_presets.character_id
      AND characters.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own character presets"
  ON character_presets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_presets.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Character-Module Relationship
-- ============================================================================
-- Links characters to modules (many-to-many with priority)

CREATE TABLE IF NOT EXISTS character_modules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  character_id uuid REFERENCES characters(id) ON DELETE CASCADE NOT NULL,
  module_id uuid REFERENCES modules(id) ON DELETE CASCADE NOT NULL,

  -- Control
  enabled boolean DEFAULT true NOT NULL,

  -- Priority (higher = applied first, useful for toggle conflicts)
  priority integer DEFAULT 0 NOT NULL,

  -- Timestamps
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Unique constraint: one character-module pair
  UNIQUE(character_id, module_id)
);

-- Indexes
CREATE INDEX idx_character_modules_character ON character_modules(character_id);
CREATE INDEX idx_character_modules_module ON character_modules(module_id);
CREATE INDEX idx_character_modules_enabled ON character_modules(character_id, enabled);
CREATE INDEX idx_character_modules_priority ON character_modules(character_id, priority DESC);

-- RLS Policies
ALTER TABLE character_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own character modules"
  ON character_modules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_modules.character_id
      AND characters.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own character modules"
  ON character_modules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM characters
      WHERE characters.id = character_modules.character_id
      AND characters.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Global Variables
-- ============================================================================
-- Stores runtime state for template variables
-- Scoped to chat sessions for dynamic values

CREATE TABLE IF NOT EXISTS global_variables (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chat_id uuid REFERENCES chats(id) ON DELETE CASCADE NOT NULL,

  -- Variable
  key text NOT NULL,
  value jsonb NOT NULL,  -- Supports string, number, boolean

  -- Timestamps
  updated_at timestamptz DEFAULT now() NOT NULL,

  -- Unique constraint: one key per chat
  UNIQUE(chat_id, key)
);

-- Indexes
CREATE INDEX idx_global_variables_user_id ON global_variables(user_id);
CREATE INDEX idx_global_variables_chat_id ON global_variables(chat_id);
CREATE INDEX idx_global_variables_key ON global_variables(chat_id, key);

-- RLS Policies
ALTER TABLE global_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own global variables"
  ON global_variables FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own global variables"
  ON global_variables FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own global variables"
  ON global_variables FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own global variables"
  ON global_variables FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_presets_updated_at
  BEFORE UPDATE ON presets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_modules_updated_at
  BEFORE UPDATE ON modules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_character_modules_updated_at
  BEFORE UPDATE ON character_modules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_global_variables_updated_at
  BEFORE UPDATE ON global_variables
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE presets IS 'RisuAI preset files (.risup) with template-based prompts';
COMMENT ON TABLE modules IS 'RisuAI module files (.risum) with toggleable extensions';
COMMENT ON TABLE character_presets IS 'Links characters to presets';
COMMENT ON TABLE character_modules IS 'Links characters to modules with priority';
COMMENT ON TABLE global_variables IS 'Runtime state for template variables (chat-scoped)';

COMMENT ON COLUMN presets.prompt_template IS 'Array of template blocks from risup promptTemplate field';
COMMENT ON COLUMN presets.config IS 'Model configuration (temperature, maxContext, etc)';
COMMENT ON COLUMN modules.toggle_definitions IS 'Variables set when module is activated';
COMMENT ON COLUMN modules.lorebook IS 'Lorebook entries (also templates!)';
COMMENT ON COLUMN modules.regex IS 'Input/output post-processing scripts';
COMMENT ON COLUMN modules.triggers IS 'Event-triggered scripts (start, manual, aftergen)';
COMMENT ON COLUMN character_modules.priority IS 'Higher priority modules applied first (for conflict resolution)';
COMMENT ON COLUMN global_variables.value IS 'JSONB value supporting string, number, boolean types';
