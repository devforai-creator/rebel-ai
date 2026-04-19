-- Harden turn/message integrity without breaking the current two-phase write order.

update public.chat_turns as chat_turns
   set user_message_id = null
 where user_message_id is not null
   and not exists (
     select 1
       from public.messages as messages
      where messages.id = chat_turns.user_message_id
        and messages.role = 'user'
        and messages.chat_id = chat_turns.chat_id
        and messages.turn_id = chat_turns.id
   );

update public.chat_turns as chat_turns
   set active_assistant_message_id = null
 where active_assistant_message_id is not null
   and not exists (
     select 1
       from public.messages as messages
      where messages.id = chat_turns.active_assistant_message_id
        and messages.role = 'assistant'
        and messages.chat_id = chat_turns.chat_id
        and messages.turn_id = chat_turns.id
        and messages.message_status = 'completed'
   );

update public.chat_turns as chat_turns
   set user_message_id = (
     select messages.id
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'user'
      order by messages.sequence asc nulls last, messages.created_at asc, messages.id asc
      limit 1
   )
 where chat_turns.user_message_id is null
   and exists (
     select 1
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'user'
   );

update public.chat_turns as chat_turns
   set active_assistant_message_id = (
     select messages.id
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'assistant'
        and messages.message_status = 'completed'
      order by messages.variant_index desc nulls last, messages.sequence desc nulls last, messages.id desc
      limit 1
   )
 where chat_turns.active_assistant_message_id is null
   and exists (
     select 1
       from public.messages as messages
      where messages.turn_id = chat_turns.id
        and messages.chat_id = chat_turns.chat_id
        and messages.role = 'assistant'
        and messages.message_status = 'completed'
   );

alter table public.chat_turns
  add constraint chat_turns_distinct_message_pointers_check
  check (
    user_message_id is null
    or active_assistant_message_id is null
    or user_message_id <> active_assistant_message_id
  );

create unique index chat_turns_active_assistant_message_id_key
  on public.chat_turns (active_assistant_message_id)
  where active_assistant_message_id is not null;

create unique index messages_assistant_turn_variant_key
  on public.messages (turn_id, variant_index)
  where role = 'assistant' and turn_id is not null and variant_index is not null;

create or replace function public.validate_chat_turn_message_pointer(
  p_turn_id uuid,
  p_chat_id uuid,
  p_message_id uuid,
  p_expected_role text,
  p_pointer_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pointer_message record;
begin
  if p_message_id is null then
    return;
  end if;

  select
    messages.id,
    messages.chat_id,
    messages.role,
    messages.turn_id,
    messages.message_status
    into pointer_message
    from public.messages as messages
   where messages.id = p_message_id;

  if not found then
    -- Allow the current two-phase write order where turns may point at a future message id.
    return;
  end if;

  if pointer_message.chat_id <> p_chat_id then
    raise exception '% must reference a message in the same chat', p_pointer_name
      using errcode = '23514';
  end if;

  if pointer_message.role <> p_expected_role then
    raise exception '% must reference a % message', p_pointer_name, p_expected_role
      using errcode = '23514';
  end if;

  if p_expected_role = 'assistant' and pointer_message.message_status <> 'completed' then
    raise exception '% must reference a completed assistant message', p_pointer_name
      using errcode = '23514';
  end if;

  if pointer_message.turn_id is distinct from p_turn_id then
    raise exception '% must reference a message attached to the same chat turn', p_pointer_name
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.validate_chat_turn_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_message_id is not null
     and new.active_assistant_message_id is not null
     and new.user_message_id = new.active_assistant_message_id then
    raise exception 'chat turn user and active assistant pointers must be distinct'
      using errcode = '23514';
  end if;

  perform public.validate_chat_turn_message_pointer(
    new.id,
    new.chat_id,
    new.user_message_id,
    'user',
    'user_message_id'
  );

  perform public.validate_chat_turn_message_pointer(
    new.id,
    new.chat_id,
    new.active_assistant_message_id,
    'assistant',
    'active_assistant_message_id'
  );

  return new;
end;
$$;

create or replace function public.validate_message_turn_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  turn_row record;
  superseded_message record;
begin
  if new.role <> 'assistant' then
    if new.variant_index is not null then
      raise exception 'Only assistant messages may set variant_index'
        using errcode = '23514';
    end if;

    if new.supersedes_message_id is not null then
      raise exception 'Only assistant messages may supersede earlier variants'
        using errcode = '23514';
    end if;

    if new.message_status <> 'completed' then
      raise exception 'Only assistant messages may use non-completed message_status values'
        using errcode = '23514';
    end if;
  end if;

  if new.turn_id is null then
    if new.role = 'assistant'
       and (new.variant_index is not null or new.supersedes_message_id is not null) then
      raise exception 'Standalone assistant messages cannot declare variants or superseded links'
        using errcode = '23514';
    end if;

    return new;
  end if;

  select
    chat_turns.id,
    chat_turns.chat_id,
    chat_turns.user_message_id
    into turn_row
    from public.chat_turns as chat_turns
   where chat_turns.id = new.turn_id;

  if not found then
    raise exception 'Referenced chat turn not found'
      using errcode = '23503';
  end if;

  if turn_row.chat_id <> new.chat_id then
    raise exception 'Message turn_id must reference a turn in the same chat'
      using errcode = '23514';
  end if;

  if new.role = 'system' then
    raise exception 'System messages cannot reference chat turns'
      using errcode = '23514';
  end if;

  if new.role = 'user' then
    if turn_row.user_message_id is not null and turn_row.user_message_id <> new.id then
      raise exception 'Chat turn already points at a different user message'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.variant_index is null then
    raise exception 'Assistant messages attached to a turn must set variant_index'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.messages as messages
     where messages.id <> new.id
       and messages.turn_id = new.turn_id
       and messages.role = 'assistant'
       and messages.variant_index = new.variant_index
  ) then
    raise exception 'Assistant variant_index must be unique within a turn'
      using errcode = '23505';
  end if;

  if new.supersedes_message_id is not null then
    select
      messages.id,
      messages.chat_id,
      messages.turn_id,
      messages.role
      into superseded_message
      from public.messages as messages
     where messages.id = new.supersedes_message_id;

    if found then
      if superseded_message.role <> 'assistant' then
        raise exception 'Assistant variants may only supersede assistant messages'
          using errcode = '23514';
      end if;

      if superseded_message.chat_id <> new.chat_id
         or superseded_message.turn_id is distinct from new.turn_id then
        raise exception 'Assistant variants may only supersede earlier variants in the same turn'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_chat_turn_references_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.role = 'user'
       and old.turn_id is not null
       and (old.turn_id is distinct from new.turn_id or new.role <> 'user') then
      update public.chat_turns
         set user_message_id = null
       where id = old.turn_id
         and user_message_id = old.id;
    end if;

    if old.role = 'assistant'
       and old.turn_id is not null
       and (
         old.turn_id is distinct from new.turn_id
         or new.role <> 'assistant'
         or new.message_status <> 'completed'
       ) then
      update public.chat_turns
         set active_assistant_message_id = null
       where id = old.turn_id
         and active_assistant_message_id = old.id;
    end if;
  end if;

  if new.role = 'user' and new.turn_id is not null then
    update public.chat_turns
       set user_message_id = new.id
     where id = new.turn_id
       and (user_message_id is null or user_message_id = new.id);
  elsif new.role = 'assistant' and new.turn_id is not null then
    if new.message_status = 'completed' then
      update public.chat_turns
         set active_assistant_message_id = new.id
       where id = new.turn_id
         and (active_assistant_message_id is null or active_assistant_message_id = new.id);
    else
      update public.chat_turns
         set active_assistant_message_id = null
       where id = new.turn_id
         and active_assistant_message_id = new.id;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.clear_chat_turn_references_on_message_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'user' and old.turn_id is not null then
    update public.chat_turns
       set user_message_id = null
     where id = old.turn_id
       and user_message_id = old.id;
  elsif old.role = 'assistant' and old.turn_id is not null then
    update public.chat_turns
       set active_assistant_message_id = null
     where id = old.turn_id
       and active_assistant_message_id = old.id;
  end if;

  return null;
end;
$$;

drop trigger if exists validate_chat_turn_integrity_trigger on public.chat_turns;
create trigger validate_chat_turn_integrity_trigger
  before insert or update of chat_id, user_message_id, active_assistant_message_id
  on public.chat_turns
  for each row execute function public.validate_chat_turn_integrity();

drop trigger if exists validate_message_turn_integrity_trigger on public.messages;
create trigger validate_message_turn_integrity_trigger
  before insert or update of chat_id, turn_id, role, variant_index, supersedes_message_id, message_status
  on public.messages
  for each row execute function public.validate_message_turn_integrity();

drop trigger if exists sync_chat_turn_references_from_message_trigger on public.messages;
create trigger sync_chat_turn_references_from_message_trigger
  after insert or update of turn_id, role, message_status
  on public.messages
  for each row execute function public.sync_chat_turn_references_from_message();

drop trigger if exists clear_chat_turn_references_on_message_delete_trigger on public.messages;
create trigger clear_chat_turn_references_on_message_delete_trigger
  after delete on public.messages
  for each row execute function public.clear_chat_turn_references_on_message_delete();
