# Chat reasoning settings

Reasoning is a per-chat, per-model preference. API keys identify credentials; registering a key no
longer asks for a reasoning level. Existing `api_keys.reasoning_effort` values remain available as a
compatibility fallback and are labelled as legacy defaults in the key list. No database migration
or environment-variable change is required.

## Settings and request lifecycle

- The model catalog's `features.reasoningControl` is the shared UI/server capability definition.
  Initially this covers Gemini 4 Argon and the supported OpenAI reasoning models. Other providers
  keep their existing invocation policies.
- `chats.model_config.reasoning` maps `provider:canonical-model-id` to a preference. Switching
  models preserves the previous model's preference; different rooms can share a credential and
  use different reasoning levels. Primary and secondary models use the same per-model map.
- `default` explicitly omits the native reasoning parameter. `none` explicitly requests reasoning
  off and is only available for models that support it. Argon supports low/medium/high and defaults
  to medium. Its reasoning cannot be turned off.
- `/api/chat` accepts optional `reasoningEffort`. It validates explicit values, otherwise resolves
  the saved chat setting, then the legacy key setting, then the model default. Unsupported values
  fail before message/job persistence. The explicit request setting also avoids a save/send race.
- Every newly submitted job snapshots `{ effort, source }` in its JSON payload. A null effort is
  an intentional omission, not a request to re-read the key. Workers use that snapshot even after
  chat/key settings change. Version-1 jobs without the field retain the legacy execution fallback.
- Debug info records the sent effort, its source, and the catalog's effective default level. The
  effective default is a documented expectation, not provider-reported telemetry.

Legacy OpenAI `none` previously omitted the parameter except on models with
`forwardReasoningEffortNone`; preserve that behavior until the chat explicitly chooses a value.
Mandatory-reasoning models continue to clamp legacy none/minimal to their existing minimum.
Utilities such as summaries and translations retain their existing settings.

## UI and verification

The toolbar contains the model selection, usage toggle, and a Model Options disclosure. Reasoning,
memory, and alternate-model controls live below it in a one-column/two-column responsive grid.
Secondary-model controls appear when alternate mode is enabled. Controls use labels and the
disclosure reports expanded state. The model selector can shrink or wrap without forcing a
minimum desktop width.

Regression coverage checks capability restrictions, explicit default versus off, legacy fallback,
independent room settings, model switching, save rollback, API admission, queued snapshots, and
native request bodies produced by the installed Google/OpenAI SDKs. Browser verification should
include narrow mobile widths, the 640px breakpoint, desktop widths, and expanded alternate options.

Capability sources (verified 2026-10-14):

- [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)
- [GPT-5.6](https://developers.openai.com/api/docs/models/gpt-5.6)
- [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4)
- [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2)
- [GPT-5.1](https://developers.openai.com/api/docs/models/gpt-5.1)
- [GPT-5](https://developers.openai.com/api/docs/models/gpt-5)
