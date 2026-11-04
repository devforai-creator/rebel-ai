-- The app issues a scoped signed upload URL after authenticating the caller.
-- Keep owner-scoped inspection and cleanup, but deny direct writes and signing.
drop policy if exists "Users can upload their CharX archives" on storage.objects;
drop policy if exists "Users can update their CharX archives" on storage.objects;
