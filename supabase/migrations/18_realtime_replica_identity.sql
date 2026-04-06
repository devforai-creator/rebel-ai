-- ============================================
-- Ensure Realtime can evaluate RLS policies
-- ============================================
-- Migration: 18_realtime_replica_identity.sql
-- Problem: Realtime drops UPDATE/DELETE events when it cannot read
--          the full row (chat_id) required by RLS policies.
-- Fix: Force Postgres to emit the full row for chat_summaries/messages.
-- Date: 2025-11-07

DO $$
BEGIN
  -- chat_summaries needs chat_id for RLS checks during updates/deletes
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_summaries'
      AND n.nspname = 'public'
      AND c.relreplident <> 'f'
  ) THEN
    ALTER TABLE public.chat_summaries REPLICA IDENTITY FULL;
  END IF;
END $$;

DO $$
BEGIN
  -- messages RLS policy also depends on chat_id, so send the full row
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'messages'
      AND n.nspname = 'public'
      AND c.relreplident <> 'f'
  ) THEN
    ALTER TABLE public.messages REPLICA IDENTITY FULL;
  END IF;
END $$;
