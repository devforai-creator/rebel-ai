-- ============================================
-- Fix multiple permissive policies for better performance
-- Removes redundant SELECT policies where FOR ALL already covers them
-- See: https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies
-- ============================================

-- ============================================
-- 1. character_modules: Remove redundant "view" policy
-- "manage" (FOR ALL) already covers SELECT
-- ============================================
DROP POLICY IF EXISTS "Users can view own character modules" ON public.character_modules;

-- ============================================
-- 2. character_presets: Remove redundant "view" policy
-- "manage" (FOR ALL) already covers SELECT
-- ============================================
DROP POLICY IF EXISTS "Users can view own character presets" ON public.character_presets;

-- ============================================
-- 3. user_feedback: Merge two SELECT policies into one
-- Combines "users can read their own feedback" + "admins can review all feedback"
-- ============================================
DROP POLICY IF EXISTS "users can read their own feedback" ON public.user_feedback;
DROP POLICY IF EXISTS "admins can review all feedback" ON public.user_feedback;

CREATE POLICY "users can read feedback" ON public.user_feedback
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.is_admin = true
    )
  );
