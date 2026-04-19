-- Enforce idempotent usage telemetry, import job state shape, and non-overlapping memory ranges.

-- 1. Usage events should be idempotent per chat request.
with ranked_usage_events as (
  select
    id,
    row_number() over (
      partition by request_id
      order by created_at asc, id asc
    ) as duplicate_rank
  from public.chat_usage_events
)
delete from public.chat_usage_events
using ranked_usage_events
where public.chat_usage_events.id = ranked_usage_events.id
  and ranked_usage_events.duplicate_rank > 1;

create unique index if not exists chat_usage_events_request_id_idx
  on public.chat_usage_events (request_id);

-- 2. Import jobs should have a coherent status/timestamp/result shape.
update public.charx_import_jobs
   set started_at = null,
       completed_at = null,
       error_message = null,
       result = null
 where status = 'pending';

update public.charx_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = null,
       error_message = null,
       result = null
 where status = 'processing';

update public.charx_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = null,
       result = coalesce(result, jsonb_build_object('success', true))
 where status = 'success';

update public.charx_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = coalesce(error_message, 'Unknown import failure'),
       result = null
 where status = 'error';

alter table public.charx_import_jobs
  drop constraint if exists charx_import_jobs_state_shape_check;

alter table public.charx_import_jobs
  add constraint charx_import_jobs_state_shape_check
  check (
    case status
      when 'pending' then
        started_at is null
        and completed_at is null
        and error_message is null
        and result is null
      when 'processing' then
        started_at is not null
        and completed_at is null
        and error_message is null
        and result is null
      when 'success' then
        started_at is not null
        and completed_at is not null
        and error_message is null
        and result is not null
      when 'error' then
        started_at is not null
        and completed_at is not null
        and error_message is not null
        and result is null
      else false
    end
  );

update public.risum_import_jobs
   set started_at = null,
       completed_at = null,
       error_message = null,
       result = null
 where status = 'pending';

update public.risum_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = null,
       error_message = null,
       result = null
 where status = 'processing';

update public.risum_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = null,
       result = coalesce(result, jsonb_build_object('success', true))
 where status = 'success';

update public.risum_import_jobs
   set started_at = coalesce(started_at, updated_at, created_at),
       completed_at = coalesce(completed_at, updated_at, created_at),
       error_message = coalesce(error_message, 'Unknown import failure'),
       result = null
 where status = 'error';

alter table public.risum_import_jobs
  drop constraint if exists risum_import_jobs_state_shape_check;

alter table public.risum_import_jobs
  add constraint risum_import_jobs_state_shape_check
  check (
    case status
      when 'pending' then
        started_at is null
        and completed_at is null
        and error_message is null
        and result is null
      when 'processing' then
        started_at is not null
        and completed_at is null
        and error_message is null
        and result is null
      when 'success' then
        started_at is not null
        and completed_at is not null
        and error_message is null
        and result is not null
      when 'error' then
        started_at is not null
        and completed_at is not null
        and error_message is not null
        and result is null
      else false
    end
  );

-- 3. Summary/fact ranges should not overlap within the same chat scope.
create or replace function public.enforce_non_overlapping_chat_summary_ranges()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from public.chat_summaries existing
     where existing.chat_id = new.chat_id
       and existing.level = new.level
       and existing.id is distinct from new.id
       and existing.start_seq <= new.end_seq
       and existing.end_seq >= new.start_seq
  ) then
    raise exception 'Overlapping chat summary range for this chat/level'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_non_overlapping_chat_summary_ranges_trigger
  on public.chat_summaries;

create trigger enforce_non_overlapping_chat_summary_ranges_trigger
  before insert or update of chat_id, level, start_seq, end_seq
  on public.chat_summaries
  for each row execute function public.enforce_non_overlapping_chat_summary_ranges();

create or replace function public.enforce_non_overlapping_chat_fact_ranges()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
      from public.chat_facts existing
     where existing.chat_id = new.chat_id
       and existing.id is distinct from new.id
       and existing.start_seq <= new.end_seq
       and existing.end_seq >= new.start_seq
  ) then
    raise exception 'Overlapping chat fact range for this chat'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_non_overlapping_chat_fact_ranges_trigger
  on public.chat_facts;

create trigger enforce_non_overlapping_chat_fact_ranges_trigger
  before insert or update of chat_id, start_seq, end_seq
  on public.chat_facts
  for each row execute function public.enforce_non_overlapping_chat_fact_ranges();
