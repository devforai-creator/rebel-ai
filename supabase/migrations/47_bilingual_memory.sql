-- Add bilingual memory support
-- Stores English translations of messages for token-efficient LLM context
-- while preserving original Korean for user-facing UI

-- 1. Add translation API key setting to profiles
ALTER TABLE profiles
ADD COLUMN translation_api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.translation_api_key_id IS 'API key to use for background message translation (Korean <-> English)';

-- 2. Add English content column to messages
ALTER TABLE messages
ADD COLUMN content_en text;

COMMENT ON COLUMN messages.content_en IS 'English translation of message content for token-efficient LLM context';
