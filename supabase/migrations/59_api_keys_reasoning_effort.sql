-- Add reasoning_effort column to api_keys
-- Allows users to control reasoning intensity for OpenAI models that support it
-- Values: 'none' (default, no reasoning), 'low', 'medium', 'high'
-- NULL means no preference set (treated as 'none' in application code)

ALTER TABLE api_keys
  ADD COLUMN reasoning_effort text
  CHECK (reasoning_effort IN ('none', 'low', 'medium', 'high'));
