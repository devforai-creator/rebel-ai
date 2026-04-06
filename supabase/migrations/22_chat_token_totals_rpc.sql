-- Chat token totals RPC for stats route

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
set search_path = public, extensions
as $$
begin
  if p_chat_id is null or p_requester is null then
    raise exception 'chat_id and requester are required';
  end if;

  if not exists (
    select 1
    from public.chats
    where id = p_chat_id
      and user_id = p_requester
  ) then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  return query
  select
    coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
    coalesce(sum(completion_tokens), 0)::bigint as completion_tokens
  from public.messages
  where chat_id = p_chat_id;
end;
$$;

revoke all on function public.get_chat_token_totals(uuid, uuid) from public;
grant execute on function public.get_chat_token_totals(uuid, uuid) to authenticated;
grant execute on function public.get_chat_token_totals(uuid, uuid) to service_role;
