# Model Catalog

Model registration is organized by provider under `src/lib/models/catalog/`. The catalog is the
single place to describe a selectable model, its pricing, aliases, defaults, and runtime
capabilities. Runtime consumers should query `@/lib/models` instead of matching model names or
maintaining separate allowlists.

## Add A Model

For an ordinary model release, edit only the matching provider catalog:

1. Add the model to the provider's `models` array in the desired UI order.
2. Set `id` and `displayName`.
3. Add `pricing` in USD per million tokens. Use `flatPricing(...)` for a single rate set or an
   explicit tier array when rates change at a prompt-token boundary.
4. Add only the capabilities that the model supports under `features`.
5. Update `defaultModel` or `lightweightModel` in the same catalog only when the provider default
   should change.

Visible models receive `uiOrder` from their array position. Set `uiVisible: false` for a registered
fallback model that should not appear in selectors; hidden models do not consume a visible order.
The catalog helper rejects defaults that do not point to a registered model.

GPT-6.1 Sol is registered as `gpt-6.1-sol`. It uses Responses for tool calling, omits legacy
`prompt_cache_retention`, and supports reasoning efforts from `low` through `max`. An absent
reasoning preference preserves the API default (`medium`). Provider defaults are unchanged.

OpenAI pricing can declare `rates.cacheWrite`. The runner reads SDK `openai.usage.cacheWriteTokens`
metadata and includes cache-write charges in input cost (`prompt_cost_usd`), without charging
those tokens again at the ordinary input rate. OpenAI output-token counts include reasoning;
usage estimation separates reasoning cost from the remaining output cost to avoid double billing.
See the [official model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
and [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching).

## Retire A Model

Remove a model only after its provider has ended API availability, not merely marked it deprecated.
Before removal, audit mutable references in legacy API-key preferences, the three profile model
preferences, chat alternate-model settings, and pending or processing chat-job payloads.

- If mutable references exist, map or clear only those settings through the normal database
  migration workflow.
- Preserve `messages.model_used` and `chat_usage_events.model_name` as immutable history.
- Update provider defaults before removing a model used as `defaultModel` or `lightweightModel`.
- Do not reuse a historical model for regeneration unless its exact ID is still registered.
- Add a regression test proving the retired ID is absent from both provider listings and lookup.

## Matching And Capabilities

- `aliases` keeps compatibility with alternate names already accepted by the app.
- `matches.prefixes` and `matches.contains` map dated or suffixed provider IDs to one catalog
  definition. Exact IDs are resolved before these family rules, and family rules before aliases.
- `features.promptCacheMinTokens` drives provider cache thresholds.
- `features.batchChat` controls Anthropic batch-chat admission.
- `features.anthropicThinking` describes Anthropic thinking behavior.
- `features.requiredToolChoice` declares whether a model accepts provider-native required tool
  choice. Set it to `false` so experimental tool users can fall back to instruction-enforced auto
  mode.
- `features.openai` describes model-specific OpenAI request-shape exceptions. Use
  `minimumReasoningEffort: 'low'` to map unsupported `none` and `minimal` preferences to `low`.
- `features.promptCaching` and `features.reasoning` describe general model support.

Add a capability instead of adding a new model-name condition to a consumer. Provider APIs can
still accept unregistered, user-entered model IDs, so narrow compatibility fallbacks may remain for
those IDs.

## Verification

`src/lib/models/catalog/contracts.test.ts` automatically exercises every registered model for:

- exact lookup and derived UI ordering;
- pricing lookup and cost estimation;
- declared cache, thinking, and batch behavior;
- declared OpenAI request-shape exceptions.

Add a focused test when a new model introduces behavior that the existing capability vocabulary
cannot express, a new pricing tier boundary, or a provider-specific request contract. Run the
normal typecheck, lint, test-with-coverage, and build checks before publishing.
