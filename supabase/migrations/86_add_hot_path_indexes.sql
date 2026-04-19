-- Add indexes for the hottest remaining read paths:
-- 1. recent-candidate chat fact retrieval for RAG
-- 2. historical chat job pruning by terminal status

create index if not exists chat_facts_recent_candidates_idx
  on public.chat_facts (chat_id, user_id, start_seq desc)
  where embedding is not null;

create index if not exists chat_generation_jobs_success_created_at_idx
  on public.chat_generation_jobs (created_at)
  where status = 'success';

create index if not exists chat_generation_jobs_error_created_at_idx
  on public.chat_generation_jobs (created_at)
  where status = 'error';
