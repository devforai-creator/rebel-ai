-- Track OpenAI service tier preference per BYOK entry

alter table public.api_keys
  add column service_tier text not null default 'standard'
    check (service_tier in ('batch', 'flex', 'priority', 'standard'));

comment on column public.api_keys.service_tier is
  'Optional OpenAI service tier preference (standard | flex | priority | batch)';
