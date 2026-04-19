alter table public.profiles
  add column if not exists enable_chat_usage_stats boolean not null default false;

comment on column public.profiles.enable_chat_usage_stats is
  'Show optional token, cache, and cost usage details in chat UI. Disabled by default to avoid extra background requests.';
