-- User-curated playthrough canon shared by multiple chat sessions.
create table public.character_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  default_persona_id uuid references public.personas(id) on delete set null,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_saves_title_length check (char_length(btrim(title)) between 1 and 100),
  constraint character_saves_content_length check (char_length(content) <= 20000)
);

alter table public.chats
  add column save_id uuid references public.character_saves(id) on delete set null;

create index idx_character_saves_user_updated
  on public.character_saves (user_id, updated_at desc, id);
create index idx_character_saves_character on public.character_saves (character_id);
create index idx_character_saves_persona on public.character_saves (default_persona_id);
create index idx_chats_save_id on public.chats (save_id) where save_id is not null;

alter table public.character_saves enable row level security;

create policy "Users can read their own saves" on public.character_saves
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users can create their own saves" on public.character_saves
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users can update their own saves" on public.character_saves
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "Users can delete their own saves" on public.character_saves
  for delete to authenticated using (user_id = (select auth.uid()));

-- RLS ownership alone does not constrain the foreign keys a client can submit.
-- Validate links on creation/relinking, including service-role writes. Existing
-- saves remain editable if a linked public card later becomes unavailable.
create function public.validate_character_save_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Save ownership cannot be changed' using errcode = '23514';
  end if;

  if new.character_id is not null and
    (tg_op = 'INSERT' or new.character_id is distinct from old.character_id) then
    if not exists (
      select 1 from public.characters c where c.id = new.character_id and (
        c.user_id = new.user_id or
        (c.archived_at is null and (c.user_id is null or c.visibility = 'public'))
      )
    ) then
      raise exception 'Character is not available for this save' using errcode = '23514';
    end if;
  end if;

  if new.default_persona_id is not null and
    (tg_op = 'INSERT' or new.default_persona_id is distinct from old.default_persona_id) then
    if not exists (
      select 1 from public.personas p
      where p.id = new.default_persona_id and p.user_id = new.user_id
    ) then
      raise exception 'Persona is not owned by the save owner' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_character_save_links
  before insert or update on public.character_saves
  for each row execute function public.validate_character_save_links();

-- Re-linking a save never rewrites historical chats. New attachments must match
-- both the chat owner and the card; ordinary updates of older chats stay valid.
create function public.validate_chat_save_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.save_id is not null and (
    tg_op = 'INSERT' or
    new.save_id is distinct from old.save_id or
    new.user_id is distinct from old.user_id or
    new.character_id is distinct from old.character_id
  ) then
    if not exists (
      select 1 from public.character_saves s
      where s.id = new.save_id and s.user_id = new.user_id
        and s.character_id = new.character_id
    ) then
      raise exception 'Save must belong to the chat owner and character' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_chat_save_link
  before insert or update of save_id, user_id, character_id on public.chats
  for each row execute function public.validate_chat_save_link();

create trigger update_character_saves_updated_at
  before update on public.character_saves
  for each row execute function public.update_updated_at_column();

-- Trigger functions are internal, not callable Data API operations.
revoke all on function public.validate_character_save_links() from public, anon, authenticated, service_role;
revoke all on function public.validate_chat_save_link() from public, anon, authenticated, service_role;

-- Explicit Data API access; keep this contract in the grants regression test.
revoke all on table public.character_saves from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.character_saves to authenticated, service_role;

comment on table public.character_saves is 'Manually curated playthrough canon, independent of card and chat deletion';
comment on column public.chats.save_id is 'Optional live save read at generation time; no per-chat content snapshot';
