-- ============================================
-- Fact Extraction Prompt for Episodic Memory
-- ============================================
-- Migration: 28_fact_extraction_prompt.sql
-- Allows users to customize fact extraction prompt for episodic memory
-- Date: 2025-11-12

-- Add fact extraction prompt column to profiles table
ALTER TABLE public.profiles
  ADD COLUMN fact_extraction_prompt TEXT;

-- Add helpful comment
COMMENT ON COLUMN public.profiles.fact_extraction_prompt IS 'Custom system prompt for extracting concrete facts from conversation chunks (episodic memory). If NULL, uses default prompt.';
