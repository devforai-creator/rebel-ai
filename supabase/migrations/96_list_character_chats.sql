-- List one character's chat rooms using message recency. Empty chat rooms stay
-- visible and use created_at as their explicit fallback position.

create or replace function public.list_character_chats(
  p_character_id uuid,
  p_page_size integer default 15,
  p_cursor_recency_at timestamptz default null,
  p_cursor_chat_id uuid default null
)
returns table (
  id uuid,
  title text,
  created_at timestamptz,
  last_message_at timestamptz,
  recency_at timestamptz,
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

  if p_character_id is null then
    raise exception 'character_id is required'
      using errcode = '22023';
  end if;

  if (p_cursor_recency_at is null) <> (p_cursor_chat_id is null) then
    raise exception 'Both cursor fields must be provided together'
      using errcode = '22023';
  end if;

  return query
  with page as (
    select
      chats.id,
      chats.title,
      chats.created_at,
      chats.last_message_at,
      coalesce(chats.last_message_at, chats.created_at) as recency_at
    from public.chats as chats
    where chats.user_id = current_user_id
      and chats.character_id = p_character_id
      and (
        p_cursor_recency_at is null
        or (
          coalesce(chats.last_message_at, chats.created_at),
          chats.id
        ) < (
          p_cursor_recency_at,
          p_cursor_chat_id
        )
      )
    order by
      coalesce(chats.last_message_at, chats.created_at) desc,
      chats.id desc
    limit effective_page_size + 1
  )
  select
    page.id,
    page.title,
    page.created_at,
    page.last_message_at,
    page.recency_at,
    preview.role as preview_role,
    preview.content as preview_content
  from page
  left join lateral (
    select
      messages.role,
      messages.content
    from public.messages as messages
    where messages.chat_id = page.id
      and messages.user_id = current_user_id
      and messages.role in ('user', 'assistant')
      and messages.message_status = 'completed'
    order by messages.sequence desc, messages.id desc
    limit 1
  ) as preview on true
  order by page.recency_at desc, page.id desc;
end;
$$;

revoke all on function public.list_character_chats(uuid, integer, timestamptz, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.list_character_chats(uuid, integer, timestamptz, uuid)
  to authenticated;

comment on function public.list_character_chats(uuid, integer, timestamptz, uuid) is
  'Lists auth.uid() chat rooms for one character by message recency, plus one lookahead row.';
