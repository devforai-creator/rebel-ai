-- Remove PL/pgSQL ambiguity by renaming record_service_health_status arguments.

drop function if exists public.record_service_health_status(text, boolean, text, jsonb);

create or replace function public.record_service_health_status(
  p_service_label text,
  p_was_success boolean,
  p_error_message text default null,
  p_metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  now_ts timestamptz := timezone('utc', now());
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if p_service_label is null or length(p_service_label) = 0 then
    raise exception 'Service label required'
      using errcode = '22004';
  end if;

  insert into public.service_health_status (
    service_label,
    total_successes,
    total_failures,
    consecutive_failures,
    last_success_at,
    last_failure_at,
    last_error_message,
    last_metadata,
    created_at,
    updated_at
  )
  values (
    p_service_label,
    case when p_was_success then 1 else 0 end,
    case when p_was_success then 0 else 1 end,
    case when p_was_success then 0 else 1 end,
    case when p_was_success then now_ts else null end,
    case when p_was_success then null else now_ts end,
    case when p_was_success then null else p_error_message end,
    p_metadata,
    now_ts,
    now_ts
  )
  on conflict (service_label) do update
  set total_successes = public.service_health_status.total_successes +
      case when p_was_success then 1 else 0 end,
      total_failures = public.service_health_status.total_failures +
      case when p_was_success then 0 else 1 end,
      consecutive_failures = case
        when p_was_success then 0
        else public.service_health_status.consecutive_failures + 1
      end,
      last_success_at = case
        when p_was_success then now_ts
        else public.service_health_status.last_success_at
      end,
      last_failure_at = case
        when p_was_success then public.service_health_status.last_failure_at
        else now_ts
      end,
      last_error_message = case
        when p_was_success then null
        else p_error_message
      end,
      last_metadata = p_metadata,
      updated_at = now_ts;
end;
$$;
