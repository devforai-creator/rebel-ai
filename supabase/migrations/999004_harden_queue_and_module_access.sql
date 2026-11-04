-- Queue submissions must pass the server's admission checks.
revoke insert on table public.chat_generation_jobs, public.charx_import_jobs
  from public, anon, authenticated;

drop policy if exists "Users can insert chat jobs" on public.chat_generation_jobs;
drop policy if exists "Users can enqueue CharX jobs" on public.charx_import_jobs;

-- Preserve historical jobs and retire mismatched jobs still eligible for execution.
alter table public.chat_generation_jobs
  add constraint chat_generation_jobs_active_payload_owner_check
  check (
    status not in ('pending', 'processing')
    or (
      (payload ->> 'chatId') is not distinct from chat_id::text
      and (payload ->> 'userId') is not distinct from user_id::text
    )
  ) not valid;

update public.chat_generation_jobs
set status = 'error',
    lifecycle_stage = 'invalid_payload',
    failure_stage = 'invalid_payload',
    error = 'Invalid job payload'
where status in ('pending', 'processing')
  and (
    (payload ->> 'chatId') is distinct from chat_id::text
    or (payload ->> 'userId') is distinct from user_id::text
  );

alter table public.chat_generation_jobs
  validate constraint chat_generation_jobs_active_payload_owner_check;

-- Preserve old links for review while excluding cross-owner links from runtime.
update public.character_modules as links
set enabled = false
from public.characters as characters, public.modules as modules
where links.character_id = characters.id
  and links.module_id = modules.id
  and links.enabled
  and characters.user_id is distinct from modules.user_id;

-- Owners can still remove old links. Writes also require owning the target module.
alter policy "Users can manage own character modules" on public.character_modules
  with check (
    exists (
      select 1 from public.characters
      where characters.id = character_modules.character_id
        and characters.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.modules
      where modules.id = character_modules.module_id
        and modules.user_id = (select auth.uid())
    )
  );
