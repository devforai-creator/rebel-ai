-- Asset metadata cannot attach a file to another user's character.
alter policy "Users can insert own character assets" on public.character_assets
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.characters
      where characters.id = character_assets.character_id
        and characters.user_id = (select auth.uid())
    )
  );

alter policy "Users can update own character assets" on public.character_assets
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.characters
      where characters.id = character_assets.character_id
        and characters.user_id = (select auth.uid())
    )
  );

-- Bind the object key to the row's owner and parent. Reject URL delimiters and
-- path segments that could be normalized to a different object.
alter table public.character_assets
  add constraint character_assets_owned_storage_path_check check (
    starts_with(storage_path, user_id::text || '/' || character_id::text || '/')
    and storage_path = btrim(storage_path)
    and storage_path !~ '(^|/)[.]{1,2}(/|$)|//|/$|[%?#[:cntrl:]]'
    and strpos(storage_path, chr(92)) = 0
  ) not valid;

alter table public.module_assets
  add constraint module_assets_owned_storage_path_check check (
    starts_with(storage_path, user_id::text || '/' || module_id::text || '/')
    and storage_path = btrim(storage_path)
    and storage_path !~ '(^|/)[.]{1,2}(/|$)|//|/$|[%?#[:cntrl:]]'
    and strpos(storage_path, chr(92)) = 0
  ) not valid;
