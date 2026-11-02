-- Validate new links without invalidating historical chats on ordinary updates.
create function public.validate_chat_character_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.character_id is distinct from old.character_id
     or new.user_id is distinct from old.user_id then
    if not exists (
      select 1 from public.characters c
      where c.id = new.character_id
        and (
          c.user_id = new.user_id
          or (c.visibility = 'public' and c.archived_at is null)
        )
    ) then
      raise exception 'Character is not accessible to the chat owner'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_chat_character_link
  before insert or update of character_id, user_id on public.chats
  for each row execute function public.validate_chat_character_link();

revoke all on function public.validate_chat_character_link()
  from public, anon, authenticated, service_role;

-- Broadcasts use private channels on both ends. Only the owner may receive;
-- there is deliberately no client INSERT policy, so only service_role can send.
create policy "Chat owners can receive assistant streams"
  on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and exists (
      select 1 from public.chats
      where chats.user_id = (select auth.uid())
        and (select realtime.topic()) = 'chat-' || chats.id::text
    )
  );

grant select on realtime.messages to authenticated;
grant select, insert on realtime.messages to service_role;
