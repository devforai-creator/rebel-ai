alter table public.profiles
  add column if not exists enable_agentic_transcript_recall_default boolean not null default false;

comment on column public.profiles.enable_agentic_transcript_recall_default is
  'Account-level default for experimental agentic transcript recall on chats that inherit the account setting.';
