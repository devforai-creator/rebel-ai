-- ============================================
-- Character Assets Storage Setup
-- Stores imported character card assets (avatars, backgrounds, etc.)
-- ============================================

-- Create storage bucket for character assets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'character-assets',
  'character-assets',
  true,  -- Public access for reading
  20971520,  -- 20MB limit per file
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

-- ============================================
-- Storage RLS Policies
-- ============================================

-- Allow users to upload to their own folders
create policy "Users can upload to their own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'character-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to update their own files
create policy "Users can update their own files"
  on storage.objects for update
  using (
    bucket_id = 'character-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to delete their own files
create policy "Users can delete their own files"
  on storage.objects for delete
  using (
    bucket_id = 'character-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow everyone to read (for public character cards)
create policy "Public read access"
  on storage.objects for select
  using (bucket_id = 'character-assets');

-- ============================================
-- Setup Complete!
-- ============================================
