-- =====================================================
-- Security Patch: Immutable Fields & Character Access
-- Prevents cross-tenant file access and unauthorized character access
-- =====================================================

-- =====================================================
-- 1. CharX Import Jobs: Restrict UPDATE to mutable fields only
-- Prevents: User changing storage_path after job creation to access other users' files
-- =====================================================

-- Drop existing permissive UPDATE policy
drop policy if exists "Users can update their CharX jobs" on public.charx_import_jobs;

-- New policy: Only allow updating status-related fields, not path/identity fields
-- Immutable after creation: storage_path, original_filename, file_type, preset_id, module_ids,
--                           rights_status, rights_attested, license_type, license_url, license_notes,
--                           source_url, source_label
-- User-mutable: None (status changes should go through runner only)
-- This effectively makes the table read-only for users after INSERT
create policy "Users can view but not update CharX jobs"
  on public.charx_import_jobs
  for update
  using (false);  -- Deny all user UPDATEs; only service role can update

-- =====================================================
-- 2. Risum Import Jobs: Restrict UPDATE to mutable fields only
-- Prevents: User changing storage_path or character_id after job creation
-- =====================================================

-- Drop existing permissive UPDATE policy
drop policy if exists "Users can update their risum jobs" on public.risum_import_jobs;

-- New policy: Deny user UPDATEs (same reasoning as CharX)
create policy "Users can view but not update risum jobs"
  on public.risum_import_jobs
  for update
  using (false);  -- Deny all user UPDATEs; only service role can update

-- =====================================================
-- 3. Chats: Enforce character ownership/visibility on INSERT
-- Prevents: User creating chat with another user's private character
-- =====================================================

-- Drop existing INSERT policy
drop policy if exists "Users can create their own chats" on public.chats;

-- New policy: Only allow creating chats with owned or public characters
create policy "Users can create chats with owned or public characters"
  on public.chats
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.characters
      where characters.id = character_id
      and (
        characters.user_id = auth.uid()
        or characters.visibility = 'public'
      )
    )
  );

-- =====================================================
-- Comments for documentation
-- =====================================================
comment on policy "Users can view but not update CharX jobs" on public.charx_import_jobs is
  'Security: Prevents users from modifying job fields (especially storage_path) after creation. All status updates go through service role.';

comment on policy "Users can view but not update risum jobs" on public.risum_import_jobs is
  'Security: Prevents users from modifying job fields (especially storage_path, character_id) after creation. All status updates go through service role.';

comment on policy "Users can create chats with owned or public characters" on public.chats is
  'Security: Ensures users can only create chats with characters they own or that are publicly visible.';
