-- ============================================
-- Fix Realtime RLS: Add user_id to messages and chat_summaries
-- ============================================
-- Migration: 26_fix_realtime_rls.sql
-- Problem: Realtime cannot evaluate complex RLS policies with subqueries/JOINs
-- Solution: Denormalize user_id to messages and chat_summaries tables
-- Date: 2025-11-09

-- 1. Add user_id column to messages table
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Add user_id column to chat_summaries table
ALTER TABLE public.chat_summaries
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Backfill existing messages with user_id from chats
UPDATE public.messages
SET user_id = chats.user_id
FROM public.chats
WHERE messages.chat_id = chats.id
AND messages.user_id IS NULL;

-- 4. Backfill existing chat_summaries with user_id from chats
UPDATE public.chat_summaries
SET user_id = chats.user_id
FROM public.chats
WHERE chat_summaries.chat_id = chats.id
AND chat_summaries.user_id IS NULL;

-- 5. Make user_id NOT NULL after backfill
ALTER TABLE public.messages
ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.chat_summaries
ALTER COLUMN user_id SET NOT NULL;

-- 6. Create function to auto-set user_id on INSERT
CREATE OR REPLACE FUNCTION public.set_message_user_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-set user_id from the related chat
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.set_chat_summary_user_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-set user_id from the related chat
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id
    FROM public.chats
    WHERE id = NEW.chat_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create triggers to auto-populate user_id
DROP TRIGGER IF EXISTS set_message_user_id_trigger ON public.messages;
CREATE TRIGGER set_message_user_id_trigger
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_message_user_id();

DROP TRIGGER IF EXISTS set_chat_summary_user_id_trigger ON public.chat_summaries;
CREATE TRIGGER set_chat_summary_user_id_trigger
  BEFORE INSERT ON public.chat_summaries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_chat_summary_user_id();

-- 8. Replace RLS policies with simpler ones that Realtime can evaluate

-- messages: Drop existing policies
DROP POLICY IF EXISTS "Users can view messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can delete messages in their chats" ON public.messages;
DROP POLICY IF EXISTS "Users can update chat messages" ON public.messages;

-- messages: Create new simplified policies
CREATE POLICY "Users can view their messages"
  ON public.messages FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their messages"
  ON public.messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their messages"
  ON public.messages FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their messages"
  ON public.messages FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text]));

-- chat_summaries: Drop existing policies
DROP POLICY IF EXISTS "Users can view summaries for their chats" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can insert summaries for their chats" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can delete summaries for their chats" ON public.chat_summaries;
DROP POLICY IF EXISTS "Users can update summaries for their chats" ON public.chat_summaries;

-- chat_summaries: Create new simplified policies
CREATE POLICY "Users can view their summaries"
  ON public.chat_summaries FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their summaries"
  ON public.chat_summaries FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their summaries"
  ON public.chat_summaries FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their summaries"
  ON public.chat_summaries FOR UPDATE
  USING (user_id = auth.uid());

-- 9. Create index for faster user_id lookups
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON public.messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_summaries_user_id ON public.chat_summaries(user_id);

-- 10. Verify the changes
COMMENT ON COLUMN public.messages.user_id IS 'Denormalized user_id for Realtime RLS compatibility';
COMMENT ON COLUMN public.chat_summaries.user_id IS 'Denormalized user_id for Realtime RLS compatibility';
