# Google Flex in chat

Open **모델 옵션 → 사용 모델 요금 방식** to choose Standard or Flex on a supported Google
model. The same credential works for both. Standard remains the default. Preferences are stored
per chat and canonical model in `chats.model_config.serviceTiers`; the alternate model has its own
control. Existing OpenAI key tiers and non-chat utilities keep their existing behavior.

Flex halves input, cached input, output, and reasoning token rates. It trades latency and
availability for price; it does not improve prompt-cache coverage. Historical temporary context
is not stored or replayed. The existing 12-minute provider deadline remains below the deployment's
800-second route limit. Google targets 1–15 minutes, so some Flex requests may exceed this app's
deadline. Capacity failures and timeouts remain failures; retries retain Flex and never silently
upgrade to Standard. Users can select Standard before retrying if they prefer.

The model catalog's `features.flex` controls availability. `/api/chat` validates the optional
`serviceTier`, resolves the saved preference when omitted, and snapshots it into the queued job.
Older Google jobs default to Standard. The browser sends its current selection explicitly to
avoid a save/send race. No database migration, new key, or environment variable is required.

Google requests use the installed SDK's native `providerOptions.google.serviceTier`. A small
response middleware also reads `usageMetadata.serviceTier`: the installed Google SDK only reads
the top-level field and otherwise loses this live telemetry. Raw chunks are inspected in memory
for the tier and are not exposed unless explicitly requested. Debug metrics distinguish
`google_requested_service_tier` from `google_actual_service_tier`. Pricing prefers the actual
reported tier; if absent, it estimates from the queued selection. All displayed costs remain
estimates; provider billing is authoritative.

Live checks on 2026-10-15 found that Argon can omit the actual-tier field even on a successful
Flex request. Gemini 3.8 has returned it inside usage metadata. A missing field remains unknown;
it is not recorded as a confirmed Standard or Flex response.

Sources verified 2026-10-15:

- [Generate Content Flex](https://ai.google.dev/gemini-api/docs/generate-content/flex-inference)
- [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)

Regression checks cover capability restrictions, config preservation, save rollback, API and
queue snapshots, native request bodies, live-shaped streaming metadata, capacity failures without
Standard fallback, and discounted cached/reasoning costs. Browser verification should cover a
saved choice after reload and expanded options at narrow/mobile and desktop widths.
