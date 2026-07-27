alter table public.profiles
  add column summary_model_name text,
  add column reprocess_model_name text,
  add column translation_model_name text;

comment on column public.profiles.summary_model_name is
  'Optional explicit model paired with summary_api_key_id. Null preserves the legacy credential preference and provider default fallbacks.';

comment on column public.profiles.reprocess_model_name is
  'Optional explicit model paired with reprocess_api_key_id. Null preserves the legacy credential preference and provider default fallbacks.';

comment on column public.profiles.translation_model_name is
  'Optional explicit model paired with translation_api_key_id. Null preserves the legacy credential preference and provider default fallbacks.';
