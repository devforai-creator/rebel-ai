-- =====================================================
-- Add JPEG MIME types to charx-uploads bucket
-- Supports RisuAI JPEG character cards
-- =====================================================

update storage.buckets
set allowed_mime_types = array[
  'application/octet-stream',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'image/png',
  'image/jpeg'
]
where id = 'charx-uploads';
