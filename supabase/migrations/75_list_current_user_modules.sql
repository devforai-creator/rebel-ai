-- Return lightweight module summaries for the current authenticated user.
-- This avoids loading large lorebook/regex/assets arrays just to compute counts.

create or replace function public.list_current_user_modules()
returns table (
  id uuid,
  name text,
  description text,
  source_file text,
  hide_icon boolean,
  created_at timestamptz,
  updated_at timestamptz,
  lorebook_count integer,
  regex_count integer,
  asset_count integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    module.id,
    module.name,
    module.description,
    module.source_file,
    coalesce(module.hide_icon, false) as hide_icon,
    module.created_at,
    module.updated_at,
    coalesce(array_length(module.lorebook, 1), 0)::integer as lorebook_count,
    coalesce(array_length(module.regex, 1), 0)::integer as regex_count,
    coalesce(array_length(module.assets, 1), 0)::integer as asset_count
  from public.modules module
  where module.user_id = auth.uid()
  order by module.created_at desc;
$$;

revoke all on function public.list_current_user_modules() from public, anon;
grant execute on function public.list_current_user_modules() to authenticated, service_role;
