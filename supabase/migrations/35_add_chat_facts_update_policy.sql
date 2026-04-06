-- ============================================================================
-- Add UPDATE policy for chat_facts table
-- Bug fix: Users were unable to update embeddings for their own chat facts
-- ============================================================================

-- Users can update their own chat facts (for re-embedding)
CREATE POLICY "Users can update their own chat facts"
  ON public.chat_facts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON POLICY "Users can update their own chat facts" ON public.chat_facts
  IS 'Allows users to update (re-embed) their own chat facts';
