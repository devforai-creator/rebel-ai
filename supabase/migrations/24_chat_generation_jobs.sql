-- Chat generation jobs queue for async LLM execution

create table public.chat_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'processing', 'success', 'error')),
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_chat_generation_jobs_status
  on public.chat_generation_jobs(status);

alter table public.chat_generation_jobs enable row level security;

create policy "Users can view their chat jobs"
  on public.chat_generation_jobs
  for select
  using (user_id = auth.uid());

create policy "Users can insert chat jobs"
  on public.chat_generation_jobs
  for insert
  with check (user_id = auth.uid());

create trigger update_chat_generation_jobs_updated_at
  before update on public.chat_generation_jobs
  for each row execute function update_updated_at_column();
