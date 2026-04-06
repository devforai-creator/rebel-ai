-- ============================================
-- Enable Realtime for chat_facts
-- ============================================
-- Migration: 29_enable_realtime_chat_facts.sql
-- Enables real-time subscriptions for chat_facts updates
-- Date: 2025-11-12

-- Add chat_facts to realtime publication (if not already added)
-- (Allows real-time UI updates when facts are created/edited/deleted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'chat_facts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_facts;
  END IF;
END $$;

-- Set replica identity to FULL for RLS to work with Realtime
-- (Required for Realtime to evaluate RLS policies correctly)
ALTER TABLE public.chat_facts REPLICA IDENTITY FULL;

-- Verify tables are in publication
-- Run this to check:
-- SELECT schemaname, tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
-- AND tablename = 'chat_facts';
