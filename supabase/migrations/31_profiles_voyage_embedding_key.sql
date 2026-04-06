-- ============================================================================
-- Migration 31: Profiles opt-in + Voyage embedding API key wiring
-- ============================================================================

alter table public.api_keys
  drop constraint if exists api_keys_provider_check;

alter table public.api_keys
  add constraint api_keys_provider_check
  check (provider in ('google', 'openai', 'anthropic', 'voyage_embeddings'));

alter table public.profiles
  add column if not exists voyage_embedding_api_key_id uuid references public.api_keys(id),
  add column if not exists enable_episodic_rag boolean not null default false;
