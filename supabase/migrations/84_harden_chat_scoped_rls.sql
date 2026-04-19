-- Harden chat-scoped denormalized ownership and privileged chat aggregate RPCs.

create or replace function public.sync_chat_owned_user_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_owner_id uuid;
begin
  if new.chat_id is null then
    raise exception 'chat_id is required'
      using errcode = '22004';
  end if;

  select chats.user_id
    into chat_owner_id
    from public.chats
   where chats.id = new.chat_id;

  if chat_owner_id is null then
    raise exception 'Chat not found'
      using errcode = '23503';
  end if;

  new.user_id := chat_owner_id;
  return new;
end;
$$;

update public.messages as messages
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = messages.chat_id
   and messages.user_id is distinct from chats.user_id;

update public.chat_summaries as chat_summaries
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_summaries.chat_id
   and chat_summaries.user_id is distinct from chats.user_id;

update public.chat_facts as chat_facts
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_facts.chat_id
   and chat_facts.user_id is distinct from chats.user_id;

update public.chat_usage_events as chat_usage_events
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_usage_events.chat_id
   and chat_usage_events.user_id is distinct from chats.user_id;

update public.chat_generation_jobs as chat_generation_jobs
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_generation_jobs.chat_id
   and chat_generation_jobs.user_id is distinct from chats.user_id;

update public.chat_turns as chat_turns
   set user_id = chats.user_id
  from public.chats as chats
 where chats.id = chat_turns.chat_id
   and chat_turns.user_id is distinct from chats.user_id;

drop trigger if exists set_message_user_id_trigger on public.messages;
create trigger set_message_user_id_trigger
  before insert or update of chat_id, user_id on public.messages
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists set_chat_summary_user_id_trigger on public.chat_summaries;
create trigger set_chat_summary_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_summaries
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_facts_user_id_trigger on public.chat_facts;
create trigger sync_chat_facts_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_facts
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_usage_events_user_id_trigger on public.chat_usage_events;
create trigger sync_chat_usage_events_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_usage_events
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_generation_jobs_user_id_trigger on public.chat_generation_jobs;
create trigger sync_chat_generation_jobs_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_generation_jobs
  for each row execute function public.sync_chat_owned_user_id();

drop trigger if exists sync_chat_turns_user_id_trigger on public.chat_turns;
create trigger sync_chat_turns_user_id_trigger
  before insert or update of chat_id, user_id on public.chat_turns
  for each row execute function public.sync_chat_owned_user_id();

drop policy if exists "Users can insert their messages" on public.messages;
drop policy if exists "Users can update their messages" on public.messages;

create policy "Users can insert their messages" on public.messages
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = messages.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their messages" on public.messages
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = messages.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = messages.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their summaries" on public.chat_summaries;
drop policy if exists "Users can update their summaries" on public.chat_summaries;

create policy "Users can insert their summaries" on public.chat_summaries
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_summaries.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their summaries" on public.chat_summaries
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = chat_summaries.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_summaries.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their own chat facts" on public.chat_facts;
drop policy if exists "Users can update their own chat facts" on public.chat_facts;

create policy "Users can insert their own chat facts" on public.chat_facts
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_facts.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own chat facts" on public.chat_facts
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = chat_facts.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_facts.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their usage events" on public.chat_usage_events;

create policy "Users can insert their usage events" on public.chat_usage_events
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_usage_events.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert chat jobs" on public.chat_generation_jobs;

create policy "Users can insert chat jobs" on public.chat_generation_jobs
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_generation_jobs.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their chat turns" on public.chat_turns;
drop policy if exists "Users can update their chat turns" on public.chat_turns;

create policy "Users can insert their chat turns" on public.chat_turns
  for insert with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_turns.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create policy "Users can update their chat turns" on public.chat_turns
  for update
  using (
    exists (
      select 1
        from public.chats
       where chats.id = chat_turns.chat_id
         and chats.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.chats
       where chats.id = chat_turns.chat_id
         and chats.user_id = (select auth.uid())
    )
  );

create or replace function public.get_chat_token_totals(
  p_chat_id uuid,
  p_requester uuid
)
returns table (
  prompt_tokens bigint,
  completion_tokens bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid;
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if auth.role() = 'service_role' then
    requester := p_requester;
  else
    requester := auth.uid();

    if requester is null or requester <> p_requester then
      raise exception 'Not authorized'
        using errcode = '42501';
    end if;
  end if;

  if not exists (
    select 1
      from public.chats as chats
     where chats.id = p_chat_id
       and chats.user_id = requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(messages.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(messages.completion_tokens), 0)::bigint as completion_tokens
      from public.messages as messages
     where messages.chat_id = p_chat_id
       and messages.user_id = requester;
end;
$$;

revoke all on function public.get_chat_token_totals(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_chat_token_totals(uuid, uuid) to authenticated;
grant execute on function public.get_chat_token_totals(uuid, uuid) to service_role;

create or replace function public.get_chat_usage_costs(
  p_chat_id uuid,
  p_requester uuid
)
returns table (
  prompt_tokens bigint,
  completion_tokens bigint,
  cached_input_tokens bigint,
  reasoning_tokens bigint,
  prompt_cost_usd double precision,
  completion_cost_usd double precision,
  cached_input_cost_usd double precision,
  reasoning_cost_usd double precision,
  total_cost_usd double precision
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid;
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if auth.role() = 'service_role' then
    requester := p_requester;
  else
    requester := auth.uid();

    if requester is null or requester <> p_requester then
      raise exception 'Not authorized'
        using errcode = '42501';
    end if;
  end if;

  if not exists (
    select 1
      from public.chats as chats
     where chats.id = p_chat_id
       and chats.user_id = requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(chat_usage_events.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(chat_usage_events.completion_tokens), 0)::bigint as completion_tokens,
      coalesce(sum(chat_usage_events.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(chat_usage_events.reasoning_tokens), 0)::bigint as reasoning_tokens,
      coalesce(sum(chat_usage_events.prompt_cost_usd), 0)::double precision as prompt_cost_usd,
      coalesce(sum(chat_usage_events.completion_cost_usd), 0)::double precision as completion_cost_usd,
      coalesce(sum(chat_usage_events.cached_input_cost_usd), 0)::double precision as cached_input_cost_usd,
      coalesce(sum(chat_usage_events.reasoning_cost_usd), 0)::double precision as reasoning_cost_usd,
      coalesce(sum(chat_usage_events.total_cost_usd), 0)::double precision as total_cost_usd
      from public.chat_usage_events as chat_usage_events
     where chat_usage_events.chat_id = p_chat_id
       and chat_usage_events.user_id = requester;
end;
$$;

revoke all on function public.get_chat_usage_costs(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to authenticated;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to service_role;

revoke all on function public.record_service_health_status(text, boolean, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_service_health_status(text, boolean, text, jsonb)
  to service_role;
