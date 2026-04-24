-- Prevent authenticated users from granting themselves operator privileges.
-- Service-role clients and direct database operators can still maintain admins.

create or replace function public.prevent_unprivileged_profile_admin_flag_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  jwt_role text := auth.role();
begin
  if (
    tg_op = 'INSERT'
    and new.is_admin is true
  ) or (
    tg_op = 'UPDATE'
    and new.is_admin is distinct from old.is_admin
  ) then
    if jwt_role = 'service_role' or current_user in ('service_role', 'postgres', 'supabase_admin') then
      return new;
    end if;

    raise exception 'profiles.is_admin is service-role managed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_unprivileged_profile_admin_flag_change_trigger
  on public.profiles;

create trigger prevent_unprivileged_profile_admin_flag_change_trigger
  before insert or update of is_admin on public.profiles
  for each row
  execute function public.prevent_unprivileged_profile_admin_flag_change();
