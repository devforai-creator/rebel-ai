-- ============================================
-- Refresh Realtime subscription after adding tables
-- ============================================
-- Migration: 19_refresh_realtime_subscription.sql
-- Problem: ALTER PUBLICATION adds tables to the publication, but existing
--          subscribers (like supabase_realtime) don't automatically see them.
-- Fix: Refresh the subscription so it starts streaming the new tables.
-- Date: 2025-11-07

-- Note: This command is idempotent - safe to run multiple times
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_subscription WHERE subname = 'supabase_realtime'
  ) THEN
    ALTER SUBSCRIPTION supabase_realtime REFRESH PUBLICATION;
  END IF;
END $$;
