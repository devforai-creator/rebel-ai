-- =====================================================
-- CharX Upload Staging Bucket
-- Stores raw user uploads before they are processed
-- =====================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'charx-uploads',
  'charx-uploads',
  false,
  157286400, -- 150MB per file (CharX archives)
  array[
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
    'application/json',
    'image/png'
  ]
)
on conflict (id) do nothing;

-- Folder layout: <user_id>/imports/<filename>

create policy "Users can upload their CharX archives"
  on storage.objects for insert
  with check (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update their CharX archives"
  on storage.objects for update
  using (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their CharX archives"
  on storage.objects for delete
  using (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read their CharX archives"
  on storage.objects for select
  using (
    bucket_id = 'charx-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
