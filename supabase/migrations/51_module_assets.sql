-- ============================================================================
-- Module Assets Storage
-- ============================================================================
-- Stores module-level assets once and reuses across characters.

-- Create storage bucket for module assets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'module-assets',
  'module-assets',
  true,  -- Public access for reading
  20971520,  -- 20MB limit per file
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

-- ============================================
-- Storage RLS Policies (module-assets bucket)
-- ============================================

-- Allow users to upload to their own folders
create policy "Module assets: users can upload to own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'module-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to update their own files
create policy "Module assets: users can update own files"
  on storage.objects for update
  using (
    bucket_id = 'module-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow users to delete their own files
create policy "Module assets: users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'module-assets'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Allow everyone to read (module assets are public)
create policy "Module assets: public read access"
  on storage.objects for select
  using (bucket_id = 'module-assets');

-- ============================================
-- Module Assets Table
-- ============================================

create table if not exists module_assets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade not null,
  module_id uuid references modules(id) on delete cascade not null,

  -- Asset identification
  file_name text not null,   -- Original filename from .risum

  -- Storage
  storage_path text not null unique,  -- Path in module-assets bucket
  content_type text,
  file_size integer,

  -- Display & Organization
  display_name text,
  display_order integer default 0,

  -- Metadata (aliases, generation info, etc)
  metadata jsonb default '{}'::jsonb,

  -- Timestamps
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,

  unique (module_id, file_name)
);

-- Indexes
create index idx_module_assets_user_id on module_assets(user_id);
create index idx_module_assets_module_id on module_assets(module_id);
create index idx_module_assets_display_name on module_assets(module_id, display_name);
create index idx_module_assets_storage_path on module_assets(storage_path);

-- ============================================
-- RLS Policies
-- ============================================

alter table module_assets enable row level security;

create policy "Users can view own module assets"
  on module_assets for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

create policy "Users can insert own module assets"
  on module_assets for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

create policy "Users can update own module assets"
  on module_assets for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

create policy "Users can delete own module assets"
  on module_assets for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from modules
      where modules.id = module_assets.module_id
      and modules.user_id = auth.uid()
    )
  );

-- ============================================
-- Triggers
-- ============================================

create trigger update_module_assets_updated_at
  before update on module_assets
  for each row
  execute function update_updated_at();

-- ============================================
-- Comments
-- ============================================

comment on table module_assets is 'Module-level assets (shared across characters)';
comment on column module_assets.storage_path is 'Path in module-assets Supabase Storage bucket';
comment on column module_assets.metadata is 'Asset metadata (aliases, generation info, etc)';
comment on column module_assets.display_name is 'Display name for module assets';
