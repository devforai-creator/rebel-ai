alter table public.profiles
  add column summary_api_key_id uuid references public.api_keys (id) on delete set null;

comment on column public.profiles.summary_api_key_id is 'Optional API key used for summary generation. Defaults to the chat API key when null.';
