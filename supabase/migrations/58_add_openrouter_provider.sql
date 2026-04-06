-- Add OpenRouter as a valid provider for api_keys
alter table public.api_keys
  drop constraint if exists api_keys_provider_check;

alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'deepseek', 'openrouter', 'voyage_embeddings'));
