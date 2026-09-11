-- Local self-hosted inference uses the existing ownership and Vault key flow.
-- No policies, secret access rights or cloud runner destinations are changed.
alter table public.api_keys drop constraint if exists api_keys_provider_check;
alter table public.api_keys add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'deepseek', 'openrouter', 'voyage_embeddings', 'local'));
