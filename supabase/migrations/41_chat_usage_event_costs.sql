-- Track cached tokens and USD costs per usage event, plus helper to aggregate totals per chat

alter table public.chat_usage_events
  add column cached_input_tokens integer,
  add column reasoning_tokens integer,
  add column prompt_cost_usd double precision not null default 0,
  add column cached_input_cost_usd double precision not null default 0,
  add column completion_cost_usd double precision not null default 0,
  add column reasoning_cost_usd double precision not null default 0,
  add column total_cost_usd double precision not null default 0;

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
set search_path = public, extensions
as $$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
      from public.chats c
     where c.id = p_chat_id
       and c.user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
    select
      coalesce(sum(e.prompt_tokens), 0)::bigint as prompt_tokens,
      coalesce(sum(e.completion_tokens), 0)::bigint as completion_tokens,
      coalesce(sum(e.cached_input_tokens), 0)::bigint as cached_input_tokens,
      coalesce(sum(e.reasoning_tokens), 0)::bigint as reasoning_tokens,
      coalesce(sum(e.prompt_cost_usd), 0)::double precision as prompt_cost_usd,
      coalesce(sum(e.completion_cost_usd), 0)::double precision as completion_cost_usd,
      coalesce(sum(e.cached_input_cost_usd), 0)::double precision as cached_input_cost_usd,
      coalesce(sum(e.reasoning_cost_usd), 0)::double precision as reasoning_cost_usd,
      coalesce(sum(e.total_cost_usd), 0)::double precision as total_cost_usd
    from public.chat_usage_events e
   where e.chat_id = p_chat_id
     and e.user_id = p_requester;
end;
$$;

revoke all on function public.get_chat_usage_costs(uuid, uuid) from public;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to authenticated;
grant execute on function public.get_chat_usage_costs(uuid, uuid) to service_role;
