-- Account-wide, optional user-message drafting configuration.
-- SQL NULL preserves the current chat model, reasoning, and service tier.
ALTER TABLE public.profiles
  ADD COLUMN user_draft_model_config jsonb
  CONSTRAINT profiles_user_draft_model_config_object
    CHECK (user_draft_model_config IS NULL OR jsonb_typeof(user_draft_model_config) = 'object');

COMMENT ON COLUMN public.profiles.user_draft_model_config IS
  'Optional account-wide cloud model, API key ID, reasoning preference and Google service tier for user-message drafting. Null follows the chat settings. Ownership and model capabilities are validated on save and invocation.';
