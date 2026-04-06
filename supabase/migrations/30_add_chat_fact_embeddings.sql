-- ============================================================================
-- Migration 30: Add pgvector embeddings to chat_facts
-- ============================================================================

create extension if not exists vector;

alter table public.chat_facts
  add column if not exists embedding vector(1024);

create index chat_facts_embedding_idx
  on public.chat_facts
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index chat_facts_user_id_idx
  on public.chat_facts (user_id);
