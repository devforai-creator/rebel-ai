-- ============================================
-- Enable Realtime for chat_summaries and messages
-- ============================================
-- Migration: 17_enable_realtime.sql
-- Enables real-time subscriptions for summary and message updates
-- Date: 2025-11-07

-- Add chat_summaries to realtime publication (if not already added)
-- (Allows real-time UI updates when summaries are created/edited/deleted)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'chat_summaries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_summaries;
  END IF;
END $$;

-- Add messages to realtime publication (if not already added)
-- (Allows real-time message count updates)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

-- Verify tables are in publication
-- Run this to check:
-- SELECT schemaname, tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
-- ORDER BY tablename;
