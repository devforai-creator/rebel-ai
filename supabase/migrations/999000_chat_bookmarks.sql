alter table public.chats add column is_bookmarked boolean not null default false;

create index idx_chats_character_bookmark_recency
  on public.chats (
    user_id, character_id, is_bookmarked desc,
    (coalesce(last_message_at, created_at)) desc, id desc
  );

-- Keep the previous RPC intact for clients using the preceding deployment.
create function public.list_character_chats_with_bookmarks(
  p_character_id uuid,
  p_page_size integer default 15,
  p_cursor_recency_at timestamptz default null,
  p_cursor_chat_id uuid default null,
  p_cursor_is_bookmarked boolean default null
)
returns table (
  id uuid, title text, created_at timestamptz, last_message_at timestamptz,
  recency_at timestamptz, is_bookmarked boolean, preview_role text, preview_content text
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
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_character_id is null then
    raise exception 'character_id is required' using errcode = '22023';
  end if;
  if not (
    (p_cursor_recency_at is null and p_cursor_chat_id is null and p_cursor_is_bookmarked is null)
    or
    (p_cursor_recency_at is not null and p_cursor_chat_id is not null and p_cursor_is_bookmarked is not null)
  ) then
    raise exception 'All cursor fields must be provided together' using errcode = '22023';
  end if;
  return query
  with page as (
    select chats.id, chats.title, chats.created_at, chats.last_message_at,
      coalesce(chats.last_message_at, chats.created_at) as recency_at, chats.is_bookmarked
    from public.chats as chats
    where chats.user_id = current_user_id and chats.character_id = p_character_id
      and (
        p_cursor_recency_at is null
        or (chats.is_bookmarked, coalesce(chats.last_message_at, chats.created_at), chats.id)
          < (p_cursor_is_bookmarked, p_cursor_recency_at, p_cursor_chat_id)
      )
    order by chats.is_bookmarked desc,
      coalesce(chats.last_message_at, chats.created_at) desc, chats.id desc
    limit effective_page_size + 1
  )
  select page.id, page.title, page.created_at, page.last_message_at,
    page.recency_at, page.is_bookmarked, preview.role, preview.content
  from page
  left join lateral (
    select messages.role, messages.content
    from public.messages as messages
    where messages.chat_id = page.id and messages.user_id = current_user_id
      and messages.role in ('user', 'assistant') and messages.message_status = 'completed'
    order by messages.sequence desc, messages.id desc limit 1
  ) as preview on true
  order by page.is_bookmarked desc, page.recency_at desc, page.id desc;
end;
$$;

revoke all on function public.list_character_chats_with_bookmarks(uuid, integer, timestamptz, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.list_character_chats_with_bookmarks(uuid, integer, timestamptz, uuid, boolean)
  to authenticated;

comment on column public.chats.is_bookmarked is
  'Owner-controlled bookmark. Bookmarked rooms precede other rooms within a character.';
