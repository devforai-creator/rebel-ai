-- Add reprocess settings to profiles table
-- Allows users to configure a custom prompt and API key for message reprocessing

ALTER TABLE profiles
ADD COLUMN reprocess_prompt text,
ADD COLUMN reprocess_api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.reprocess_prompt IS 'Custom system prompt for message reprocessing (translation, style correction, etc.)';
COMMENT ON COLUMN profiles.reprocess_api_key_id IS 'API key to use for message reprocessing';
