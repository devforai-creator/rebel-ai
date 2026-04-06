-- ============================================================================
-- 25_allow_message_updates.sql
-- Allow chat owners to edit their own user/assistant messages
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'Users can update chat messages'
  ) then
    create policy "Users can update chat messages"
      on public.messages for update
      using (
        exists (
          select 1
          from public.chats
          where chats.id = messages.chat_id
            and chats.user_id = auth.uid()
        )
      )
      with check (role in ('user', 'assistant'));
  end if;
end
$$;
