/**
 * Add toggle_definitions to presets table
 *
 * RisuAI presets include customPromptTemplateToggle which defines
 * toggle UI elements (checkboxes, selects, text inputs).
 * Modules reference these toggles via getglobalvar::<key>.
 */

-- Add toggle_definitions column to presets table
ALTER TABLE presets
ADD COLUMN IF NOT EXISTS toggle_definitions jsonb DEFAULT '{}'::jsonb;

-- Comment
COMMENT ON COLUMN presets.toggle_definitions IS
  'Toggle definitions from customPromptTemplateToggle. Format: {key: {label, type, value, options?}}';
