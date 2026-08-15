-- Return one recent-conversation row per character for the current user.
-- The function intentionally returns one extra row so the application can
-- determine whether another page exists without a separate count query.

create or replace function public.list_recent_conversation_characters(
  p_page_size integer default 15,
  p_cursor_last_message_at timestamptz default null,
  p_cursor_character_id uuid default null
)
returns table (
  character_id uuid,
  character_name text,
  avatar_url text,
  last_message_at timestamptz,
  latest_chat_id uuid,
  latest_chat_title text,
  preview_role text,
  preview_content text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  effective_page_size integer := greatest(1, least(coalesce(p_page_size, 15), 50));
begin
  if current_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  if (p_cursor_last_message_at is null) <> (p_cursor_character_id is null) then
    raise exception 'Both cursor fields must be provided together'
      using errcode = '22023';
  end if;

  return query
  with representative_chats as (
    select distinct on (chats.character_id)
      chats.character_id,
      characters.name as character_name,
      characters.avatar_url,
      chats.last_message_at,
      chats.id as latest_chat_id,
      chats.title as latest_chat_title
    from public.chats as chats
    join public.characters as characters
      on characters.id = chats.character_id
     and characters.archived_at is null
    where chats.user_id = current_user_id
      and chats.last_message_at is not null
    order by
      chats.character_id,
      chats.last_message_at desc,
      chats.id desc
  ),
  page as (
    select
      representative_chats.character_id,
      representative_chats.character_name,
      representative_chats.avatar_url,
      representative_chats.last_message_at,
      representative_chats.latest_chat_id,
      representative_chats.latest_chat_title
    from representative_chats
    where p_cursor_last_message_at is null
       or (
         representative_chats.last_message_at,
         representative_chats.character_id
       ) < (
         p_cursor_last_message_at,
         p_cursor_character_id
       )
    order by
      representative_chats.last_message_at desc,
      representative_chats.character_id desc
    limit effective_page_size + 1
  )
  select
    page.character_id,
    page.character_name,
    page.avatar_url,
    page.last_message_at,
    page.latest_chat_id,
    page.latest_chat_title,
    preview.role as preview_role,
    preview.content as preview_content
  from page
  left join lateral (
    select
      messages.role,
      messages.content
    from public.messages as messages
    where messages.chat_id = page.latest_chat_id
      and messages.user_id = current_user_id
      and messages.role in ('user', 'assistant')
      and messages.message_status = 'completed'
    order by messages.sequence desc, messages.id desc
    limit 1
  ) as preview on true
  order by page.last_message_at desc, page.character_id desc;
end;
$$;

revoke all on function public.list_recent_conversation_characters(integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.list_recent_conversation_characters(integer, timestamptz, uuid)
  to authenticated;

comment on function public.list_recent_conversation_characters(integer, timestamptz, uuid) is
  'Lists one recent chat per accessible character for auth.uid(), plus one lookahead row.';
