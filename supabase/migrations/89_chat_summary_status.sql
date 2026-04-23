alter table public.chat_summaries
  add column if not exists summary_status text not null default 'ok';

alter table public.chat_summaries
  drop constraint if exists chat_summaries_summary_status_check;

alter table public.chat_summaries
  add constraint chat_summaries_summary_status_check
  check (summary_status in ('ok', 'fallback'));

comment on column public.chat_summaries.summary_status is
  'Current content state for this summary row: ok for model-generated content, fallback for local fallback content.';
