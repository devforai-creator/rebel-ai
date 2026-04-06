-- Lightweight user feedback submissions for retention insights

create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(trim(message)) > 0),
  source_page text,
  created_at timestamptz not null default now()
);

create index idx_user_feedback_user_created_at
  on public.user_feedback (user_id, created_at desc);

alter table public.user_feedback enable row level security;

create policy "users can insert their own feedback"
  on public.user_feedback
  for insert
  with check (auth.uid() = user_id);

create policy "users can read their own feedback"
  on public.user_feedback
  for select
  using (auth.uid() = user_id);

create policy "admins can review all feedback"
  on public.user_feedback
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and coalesce(p.is_admin, false) = true
    )
  );
