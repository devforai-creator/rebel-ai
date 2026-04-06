-- ============================================
-- Custom Summary Prompts for Users
-- ============================================
-- Migration: 16_custom_summary_prompts.sql
-- Allows users to customize their summary generation prompts
-- Date: 2025-11-07

-- Add custom summary prompt columns to profiles table
ALTER TABLE public.profiles
  ADD COLUMN chunk_summary_prompt TEXT,
  ADD COLUMN meta_summary_prompt TEXT;

-- Add helpful comments
COMMENT ON COLUMN public.profiles.chunk_summary_prompt IS 'Custom system prompt for chunk-level summaries (10 messages). If NULL, uses default prompt.';
COMMENT ON COLUMN public.profiles.meta_summary_prompt IS 'Custom system prompt for meta-level summaries (100 messages). If NULL, uses default prompt.';
