-- Broadcast announcements for urgent notices

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  cta_label text,
  cta_url text,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  is_active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  author_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_announcements_active_window
  on public.announcements (is_active, starts_at desc, ends_at);

alter table public.announcements enable row level security;

create policy "Authenticated users can read announcements"
  on public.announcements
  for select
  using (auth.uid() is not null);

create trigger update_announcements_updated_at
  before update on public.announcements
  for each row execute function update_updated_at_column();
