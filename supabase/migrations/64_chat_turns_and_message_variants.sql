-- ============================================================================
-- 64_chat_turns_and_message_variants.sql
-- Introduce chat turns and assistant message variants for safe regeneration.
-- ============================================================================

create table public.chat_turns (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  turn_index bigint not null,
  user_message_id uuid,
  active_assistant_message_id uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (chat_id, turn_index),
  unique (user_message_id)
);

create index chat_turns_chat_id_turn_index_idx
  on public.chat_turns (chat_id, turn_index desc);

alter table public.chat_turns enable row level security;

create policy "Users can view their chat turns" on public.chat_turns
  for select using (user_id = (select auth.uid()));

create policy "Users can insert their chat turns" on public.chat_turns
  for insert with check (user_id = (select auth.uid()));

create policy "Users can update their chat turns" on public.chat_turns
  for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can delete their chat turns" on public.chat_turns
  for delete using (user_id = (select auth.uid()));

create trigger update_chat_turns_updated_at
  before update on public.chat_turns
  for each row execute function update_updated_at_column();

alter table public.messages
  add column turn_id uuid references public.chat_turns(id) on delete cascade,
  add column variant_index integer,
  add column supersedes_message_id uuid references public.messages(id) on delete set null,
  add column message_status text default 'completed' not null;

alter table public.messages
  add constraint messages_message_status_check
    check (message_status in ('completed', 'generating', 'superseded')),
  add constraint messages_variant_index_positive_check
    check (variant_index is null or variant_index > 0);

create index messages_chat_id_status_sequence_idx
  on public.messages (chat_id, message_status, sequence desc);

create index messages_turn_id_role_variant_idx
  on public.messages (turn_id, role, variant_index desc);

create index messages_supersedes_message_id_idx
  on public.messages (supersedes_message_id)
  where supersedes_message_id is not null;

do $$
declare
  chat_row record;
  message_row record;
  current_turn_id uuid;
  current_turn_index bigint;
  current_active_assistant_id uuid;
  current_variant_index integer;
begin
  for chat_row in
    select id, user_id
    from public.chats
    order by created_at asc, id asc
  loop
    current_turn_id := null;
    current_turn_index := 0;
    current_active_assistant_id := null;
    current_variant_index := 0;

    for message_row in
      select id, role
      from public.messages
      where chat_id = chat_row.id
      order by sequence asc
    loop
      if message_row.role = 'system' then
        continue;
      end if;

      if message_row.role = 'user' then
        current_turn_index := current_turn_index + 1;
        current_turn_id := gen_random_uuid();
        current_active_assistant_id := null;
        current_variant_index := 0;

        insert into public.chat_turns (
          id,
          chat_id,
          user_id,
          turn_index,
          user_message_id,
          active_assistant_message_id
        )
        values (
          current_turn_id,
          chat_row.id,
          chat_row.user_id,
          current_turn_index,
          message_row.id,
          null
        );

        update public.messages
        set
          turn_id = current_turn_id,
          variant_index = null,
          supersedes_message_id = null,
          message_status = 'completed'
        where id = message_row.id;

        continue;
      end if;

      if current_turn_id is null then
        current_turn_index := current_turn_index + 1;
        current_turn_id := gen_random_uuid();
        current_active_assistant_id := null;
        current_variant_index := 0;

        insert into public.chat_turns (
          id,
          chat_id,
          user_id,
          turn_index,
          user_message_id,
          active_assistant_message_id
        )
        values (
          current_turn_id,
          chat_row.id,
          chat_row.user_id,
          current_turn_index,
          null,
          null
        );
      end if;

      current_variant_index := current_variant_index + 1;

      if current_active_assistant_id is not null then
        update public.messages
        set message_status = 'superseded'
        where id = current_active_assistant_id;
      end if;

      update public.messages
      set
        turn_id = current_turn_id,
        variant_index = current_variant_index,
        supersedes_message_id = current_active_assistant_id,
        message_status = 'completed'
      where id = message_row.id;

      update public.chat_turns
      set active_assistant_message_id = message_row.id
      where id = current_turn_id;

      current_active_assistant_id := message_row.id;
    end loop;
  end loop;
end
$$;
