-- Durable service-health snapshots for internal operators.
-- This keeps last success/failure state across deploys, warm restarts, and
-- multiple serverless instances.

create table if not exists public.service_health_status (
  service_label text primary key,
  total_successes bigint not null default 0,
  total_failures bigint not null default 0,
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_message text,
  last_metadata jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_health_status_service_label_check
    check (service_label is not null and length(service_label) > 0)
);

alter table public.service_health_status enable row level security;

revoke all on table public.service_health_status from public, anon, authenticated;
grant select, insert, update on table public.service_health_status to service_role;

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
  now_ts timestamptz := timezone('utc', now());
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Not authorized'
      using errcode = '42501';
  end if;

  if service_label is null or length(service_label) = 0 then
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
    service_label,
    case when was_success then 1 else 0 end,
    case when was_success then 0 else 1 end,
    case when was_success then 0 else 1 end,
    case when was_success then now_ts else null end,
    case when was_success then null else now_ts end,
    case when was_success then null else error_message end,
    metadata,
    now_ts,
    now_ts
  )
  on conflict (service_label) do update
  set total_successes = public.service_health_status.total_successes +
      case when was_success then 1 else 0 end,
      total_failures = public.service_health_status.total_failures +
      case when was_success then 0 else 1 end,
      consecutive_failures = case
        when was_success then 0
        else public.service_health_status.consecutive_failures + 1
      end,
      last_success_at = case
        when was_success then now_ts
        else public.service_health_status.last_success_at
      end,
      last_failure_at = case
        when was_success then public.service_health_status.last_failure_at
        else now_ts
      end,
      last_error_message = case
        when was_success then null
        else error_message
      end,
      last_metadata = metadata,
      updated_at = now_ts;
end;
$$;

revoke all on function public.record_service_health_status(text, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_service_health_status(text, boolean, text, jsonb)
  to service_role;
