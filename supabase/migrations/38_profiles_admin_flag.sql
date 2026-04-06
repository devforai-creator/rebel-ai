-- Add admin flag to profiles for operator-only features

alter table public.profiles
add column if not exists is_admin boolean not null default false;
