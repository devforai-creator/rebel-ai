-- ============================================================================
-- Add per-chat custom system prompt override
-- Allows users to replace the global system prompt via the dashboard UI
-- ============================================================================

ALTER TABLE public.chats
  ADD COLUMN custom_system_prompt text;

COMMENT ON COLUMN public.chats.custom_system_prompt
  IS 'Optional override prepended ahead of character/preset prompts. When NULL, the global system prompt is used.';
