-- ============================================================================
-- Chat Facts (Episodic Memory) Table
-- Stores concrete, specific facts extracted from conversations
-- Complements chat_summaries (semantic memory) by preserving detailed information
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chat_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_seq int NOT NULL,
  end_seq int NOT NULL,
  facts text NOT NULL,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT chat_facts_unique_range UNIQUE (chat_id, start_seq, end_seq),
  CONSTRAINT chat_facts_valid_range CHECK (start_seq > 0 AND end_seq >= start_seq)
);

-- Indexes for efficient retrieval
CREATE INDEX idx_chat_facts_chat_id ON public.chat_facts(chat_id);
CREATE INDEX idx_chat_facts_sequence_range ON public.chat_facts(chat_id, start_seq, end_seq);

-- RLS Policies
ALTER TABLE public.chat_facts ENABLE ROW LEVEL SECURITY;

-- Users can view their own chat facts
CREATE POLICY "Users can view their own chat facts"
  ON public.chat_facts FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own chat facts
CREATE POLICY "Users can insert their own chat facts"
  ON public.chat_facts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own chat facts
CREATE POLICY "Users can delete their own chat facts"
  ON public.chat_facts FOR DELETE
  USING (user_id = auth.uid());

-- Comments
COMMENT ON TABLE public.chat_facts IS 'Episodic memory: Stores specific facts extracted from conversation chunks (e.g., dates, places, preferences) that would be lost in summaries.';
COMMENT ON COLUMN public.chat_facts.facts IS 'Plain text bullet points of concrete facts, extracted by LLM from messages in the sequence range.';
COMMENT ON COLUMN public.chat_facts.start_seq IS 'Starting message sequence number (inclusive).';
COMMENT ON COLUMN public.chat_facts.end_seq IS 'Ending message sequence number (inclusive).';
