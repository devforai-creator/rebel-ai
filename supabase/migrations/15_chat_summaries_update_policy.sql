-- ============================================
-- Add UPDATE policy for chat_summaries
-- ============================================
-- Migration: 15_chat_summaries_update_policy.sql
-- Fixes: Users unable to edit their chat summaries
-- Date: 2025-11-07

create policy "Users can update summaries for their chats"
  on public.chat_summaries
  for update
  using (
    exists (
      select 1
      from public.chats
      where chats.id = chat_id
        and chats.user_id = auth.uid()
    )
  );
