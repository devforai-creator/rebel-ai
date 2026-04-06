-- Add DeepSeek as a supported LLM provider

-- Drop existing constraint
alter table public.api_keys
  drop constraint if exists api_keys_provider_check;

-- Add updated constraint with deepseek
alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'deepseek', 'voyage_embeddings'));
