-- Independent reasoning preference for the account's summary-dedicated model.
-- Default preserves the existing provider/model behavior.
ALTER TABLE public.profiles
  ADD COLUMN summary_reasoning_effort text NOT NULL DEFAULT 'default'
  CONSTRAINT profiles_summary_reasoning_effort_check
    CHECK (summary_reasoning_effort IN
      ('default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'));

COMMENT ON COLUMN public.profiles.summary_reasoning_effort IS
  'Independent reasoning preference for summaries, higher-level summaries and fact extraction. Model capabilities are validated on save and invocation. Default preserves provider/model behavior.';
