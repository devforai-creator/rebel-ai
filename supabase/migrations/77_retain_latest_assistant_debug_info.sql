-- Keep server-side debug_info only on the newest assistant message per chat.
-- Older assistant messages can still be displayed, but they no longer retain
-- heavyweight server diagnostics once a newer assistant reply exists.

with ranked_assistant_messages as (
  select
    message.id,
    row_number() over (
      partition by message.chat_id
      order by message.sequence desc nulls last, message.created_at desc, message.id desc
    ) as recency_rank
  from public.messages as message
  where message.role = 'assistant'
    and message.debug_info is not null
)
update public.messages as message
set debug_info = null
from ranked_assistant_messages as ranked
where message.id = ranked.id
  and ranked.recency_rank > 1
  and message.debug_info is not null;
