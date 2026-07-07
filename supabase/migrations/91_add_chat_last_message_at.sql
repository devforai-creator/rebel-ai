-- Add a denormalized chat recency timestamp for recent-conversation lists.

alter table public.chats
  add column last_message_at timestamptz;

update public.chats as chats
   set last_message_at = message_recency.last_message_at
  from (
    select
      messages.chat_id,
      max(messages.created_at) as last_message_at
    from public.messages as messages
    where messages.role in ('user', 'assistant')
    group by messages.chat_id
  ) as message_recency
 where chats.id = message_recency.chat_id;

create or replace function public.advance_chat_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role in ('user', 'assistant') then
    update public.chats
       set last_message_at = greatest(
         coalesce(last_message_at, new.created_at),
         new.created_at
       )
     where id = new.chat_id;
  end if;

  return null;
end;
$$;

drop trigger if exists advance_chat_last_message_at_trigger on public.messages;
create trigger advance_chat_last_message_at_trigger
  after insert on public.messages
  for each row execute function public.advance_chat_last_message_at();

create or replace function public.recalculate_chat_last_message_at(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chats as chats
     set last_message_at = (
       select max(messages.created_at)
         from public.messages as messages
        where messages.chat_id = p_chat_id
          and messages.role in ('user', 'assistant')
     )
   where chats.id = p_chat_id;
end;
$$;

revoke execute on function public.recalculate_chat_last_message_at(uuid) from public;

create or replace function public.recalculate_chat_last_message_at_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role in ('user', 'assistant') then
    perform public.recalculate_chat_last_message_at(old.chat_id);
  end if;

  return null;
end;
$$;

drop trigger if exists recalculate_chat_last_message_at_after_delete_trigger on public.messages;
create trigger recalculate_chat_last_message_at_after_delete_trigger
  after delete on public.messages
  for each row execute function public.recalculate_chat_last_message_at_after_delete();

create or replace function public.recalculate_chat_last_message_at_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.chat_id is distinct from new.chat_id then
    if old.role in ('user', 'assistant') then
      perform public.recalculate_chat_last_message_at(old.chat_id);
    end if;

    if new.role in ('user', 'assistant') then
      perform public.recalculate_chat_last_message_at(new.chat_id);
    end if;

    return null;
  end if;

  if old.role is distinct from new.role
     or old.created_at is distinct from new.created_at then
    if old.role in ('user', 'assistant')
       or new.role in ('user', 'assistant') then
      perform public.recalculate_chat_last_message_at(new.chat_id);
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists recalculate_chat_last_message_at_after_update_trigger on public.messages;
create trigger recalculate_chat_last_message_at_after_update_trigger
  after update of chat_id, role, created_at on public.messages
  for each row execute function public.recalculate_chat_last_message_at_after_update();