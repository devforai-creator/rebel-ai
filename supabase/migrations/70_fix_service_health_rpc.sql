-- Fix PL/pgSQL name ambiguity in record_service_health_status after the initial
-- durable health migration.

create or replace function public.record_service_health_status(
  service_label text,
  was_success boolean,
  error_message text default null,
  metadata jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  input_service_label alias for $1;
  input_was_success alias for $2;
  input_error_message alias for $3;
  input_metadata alias for $4;
  now_ts timestamptz := timezone('utc', now());
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if input_service_label is null or length(input_service_label) = 0 then
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
    input_service_label,
    case when input_was_success then 1 else 0 end,
    case when input_was_success then 0 else 1 end,
    case when input_was_success then 0 else 1 end,
    case when input_was_success then now_ts else null end,
    case when input_was_success then null else now_ts end,
    case when input_was_success then null else input_error_message end,
    input_metadata,
    now_ts,
    now_ts
  )
  on conflict (service_label) do update
  set total_successes = public.service_health_status.total_successes +
      case when input_was_success then 1 else 0 end,
      total_failures = public.service_health_status.total_failures +
      case when input_was_success then 0 else 1 end,
      consecutive_failures = case
        when input_was_success then 0
        else public.service_health_status.consecutive_failures + 1
      end,
      last_success_at = case
        when input_was_success then now_ts
        else public.service_health_status.last_success_at
      end,
      last_failure_at = case
        when input_was_success then public.service_health_status.last_failure_at
        else now_ts
      end,
      last_error_message = case
        when input_was_success then null
        else input_error_message
      end,
      last_metadata = input_metadata,
      updated_at = now_ts;
end;
$$;
