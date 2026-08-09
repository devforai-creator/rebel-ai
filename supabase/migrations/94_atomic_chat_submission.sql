-- Persist a chat submission and its generation job in one transaction.
-- The RPC is service-only so job payloads and API-key references stay behind
-- the existing /api/chat server boundary.

create or replace function public.submit_chat_generation_job(
  p_chat_id uuid,
  p_requester uuid,
  p_turn_id uuid,
  p_user_message_id uuid,
  p_user_message_content text,
  p_job_payload jsonb,
  p_delivery_mode text,
  p_is_regeneration boolean,
  p_regenerate_assistant_message_id uuid
)
returns table (
  job_id uuid,
  turn_id uuid,
  user_message_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_turn_id uuid;
  effective_user_message_id uuid;
  latest_turn_id uuid;
  next_turn_index bigint;
  inserted_job_id uuid;
  effective_job_payload jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_chat_id is null
     or p_requester is null
     or p_job_payload is null
     or jsonb_typeof(p_job_payload) is distinct from 'object' then
    raise exception 'Invalid chat submission'
      using errcode = '22023';
  end if;

  if p_delivery_mode not in ('streaming', 'anthropic_batch') then
    raise exception 'Invalid chat delivery mode'
      using errcode = '22023';
  end if;

  if p_job_payload ->> 'chatId' is distinct from p_chat_id::text
     or p_job_payload ->> 'userId' is distinct from p_requester::text
     or p_job_payload ->> 'deliveryMode' is distinct from p_delivery_mode
     or p_job_payload ->> 'isRegeneration' is distinct from (
       case when p_is_regeneration then 'true' else 'false' end
     ) then
    raise exception 'Chat submission payload does not match its envelope'
      using errcode = '22023';
  end if;

  -- Lock the owned chat before admission or turn allocation. Requests for
  -- different chats remain independent, while same-chat submissions serialize.
  perform 1
    from public.chats as chats
   where chats.id = p_chat_id
     and chats.user_id = p_requester
   for update;

  if not found then
    raise exception 'Chat not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from public.chat_generation_jobs as jobs
     where jobs.chat_id = p_chat_id
       and jobs.status in ('pending', 'processing')
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate key value violates unique constraint "chat_generation_jobs_active_chat_idx"',
      constraint = 'chat_generation_jobs_active_chat_idx';
  end if;

  if p_is_regeneration then
    if p_turn_id is not null
       or p_user_message_id is not null
       or p_user_message_content is not null
       or p_regenerate_assistant_message_id is null
       or p_job_payload ->> 'regenerateAssistantMessageId'
         is distinct from p_regenerate_assistant_message_id::text then
      raise exception 'Invalid regeneration target'
        using errcode = '22023';
    end if;

    select turns.id
      into effective_turn_id
      from public.chat_turns as turns
     where turns.chat_id = p_chat_id
       and turns.active_assistant_message_id = p_regenerate_assistant_message_id;

    if not found then
      raise exception 'Invalid regeneration target'
        using errcode = '22023';
    end if;

    select turns.id
      into latest_turn_id
      from public.chat_turns as turns
     where turns.chat_id = p_chat_id
     order by turns.turn_index desc
     limit 1;

    if latest_turn_id is distinct from effective_turn_id then
      raise exception 'Only the latest assistant message can be regenerated'
        using errcode = '22023';
    end if;

    effective_user_message_id := null;
  else
    if p_turn_id is null
       or p_user_message_id is null
       or p_user_message_content is null
       or p_regenerate_assistant_message_id is not null
       or p_job_payload ->> 'turnId' is distinct from p_turn_id::text then
      raise exception 'Invalid user message'
        using errcode = '22023';
    end if;

    select coalesce(max(turns.turn_index), 0) + 1
      into next_turn_index
      from public.chat_turns as turns
     where turns.chat_id = p_chat_id;

    insert into public.chat_turns (
      id,
      chat_id,
      user_id,
      turn_index,
      user_message_id,
      active_assistant_message_id
    )
    values (
      p_turn_id,
      p_chat_id,
      p_requester,
      next_turn_index,
      p_user_message_id,
      null
    );

    insert into public.messages (
      id,
      chat_id,
      user_id,
      role,
      content,
      turn_id,
      message_status
    )
    values (
      p_user_message_id,
      p_chat_id,
      p_requester,
      'user',
      p_user_message_content,
      p_turn_id,
      'completed'
    );

    effective_turn_id := p_turn_id;
    effective_user_message_id := p_user_message_id;
  end if;

  effective_job_payload := jsonb_set(
    p_job_payload,
    '{turnId}',
    to_jsonb(effective_turn_id),
    true
  );

  insert into public.chat_generation_jobs (
    chat_id,
    user_id,
    status,
    lifecycle_stage,
    failure_stage,
    delivery_mode,
    payload
  )
  values (
    p_chat_id,
    p_requester,
    'pending',
    'queued',
    null,
    p_delivery_mode,
    effective_job_payload
  )
  returning id into inserted_job_id;

  return query
  select inserted_job_id, effective_turn_id, effective_user_message_id;
end;
$$;

revoke all on function public.submit_chat_generation_job(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  uuid
) from public, anon, authenticated;

grant execute on function public.submit_chat_generation_job(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  boolean,
  uuid
) to service_role;
