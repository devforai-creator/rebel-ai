# First-Class Path Map

Updated: 2026-04-22

This document is the smallest useful map of the maintained chat path for the
current operating mode.

It is not a full architecture spec.
Exact behavior still lives in code, tests, migrations, and the deployed system.

## Supported Success Path

The maintained chat success contract is:

`request accepted -> user turn persisted -> job queued -> runner executes -> assistant response persisted -> active turn state updated`

For the current repo, that path is owned by these modules.

## 1. Request Acceptance

- [route.ts](../src/app/api/chat/route.ts): top-level HTTP orchestration
- [request-contract.ts](../src/app/api/chat/request-contract.ts): request parsing,
  normalization, regeneration contract
- [chat-admission.ts](../src/app/api/chat/chat-admission.ts): chat ownership,
  active-job admission, regeneration target lookup
- [delivery-mode-admission.ts](../src/app/api/chat/delivery-mode-admission.ts):
  delivery-mode validation, including experimental Claude Batch gating

This stage decides whether the request is allowed to proceed.
It should stay short and readable.

## 2. Durable Request Write And Queue

- [submit-chat-job.ts](../src/app/api/chat/submit-chat-job.ts): submit-path
  orchestration after admission succeeds
- [job-persistence.ts](../src/app/api/chat/job-persistence.ts): durable user-turn
  insert and job enqueue
- [background-trigger.ts](../src/app/api/chat/background-trigger.ts): runner
  trigger dispatch and lifecycle-stage signal

Durable ownership in this stage:

- persist the new user turn for non-regeneration requests
- insert the queued chat job row
- store enough lifecycle evidence to triage trigger dispatch issues

## 3. Runner Execution

- [route.ts](../src/app/api/internal/chat-job-runner/route.ts): authenticated
  internal runner entry
- [service.ts](../src/app/api/internal/chat-job-runner/service.ts): job claim,
  loop, stage orchestration
- [process-job-stage.ts](../src/app/api/internal/chat-job-runner/process-job-stage.ts):
  per-job execution wrapper
- [execution-context.ts](../src/app/api/internal/chat-job-runner/execution-context.ts):
  transcript, lorebook, memory, and prompt context loading
- [provider-request-stage.ts](../src/app/api/internal/chat-job-runner/provider-request-stage.ts):
  provider call or batch submission selection
- [streaming-response-stage.ts](../src/app/api/internal/chat-job-runner/streaming-response-stage.ts):
  response consumption and stream-state handling

This stage owns turning a queued job into a concrete assistant response.

## 4. Durable Response Write

- [post-processing-stage.ts](../src/app/api/internal/chat-job-runner/post-processing-stage.ts):
  post-response orchestration
- [post-generation-pipeline.ts](../src/app/api/internal/chat-job-runner/post-generation-pipeline.ts):
  durable post-generation shell
- [assistant-finalization.ts](../src/app/api/internal/chat-job-runner/assistant-finalization.ts):
  assistant insert/update, regeneration replacement, active turn state
- [post-generation-metadata.ts](../src/app/api/internal/chat-job-runner/post-generation-metadata.ts):
  non-blocking operational metadata and hygiene writes such as stale
  `debug_info` cleanup, `api_keys.last_used_at`, and usage-event inserts

Durable ownership in this stage:

- finalize the assistant message
- update active assistant state for the turn
- persist the accepted assistant row and retained server `debug_info`

Additional operational metadata in this stage is valuable, but it currently
fails open and does not redefine chat success. That includes older-assistant
`debug_info` cleanup, `api_keys.last_used_at`, and `chat_usage_events`.

## 5. Best-Effort Follow-Ups

These are intentionally outside the durable core success path.

- [post-submit-effects.ts](../src/app/api/chat/post-submit-effects.ts): route-side
  experimental follow-ups after enqueue
- [post-generation-followups.ts](../src/app/api/internal/chat-job-runner/post-generation-followups.ts):
  runner-side summary trigger and assistant translation trigger
- [translation-trigger.ts](../src/lib/chat/translation-trigger.ts): background
  translation dispatch
- [summary-trigger.ts](../src/lib/chat/summary-trigger.ts): background summary
  generation dispatch

Failure here should not redefine chat success.
It should leave triage evidence and stay disposable.

## 6. Explicitly Not First-Class

These paths may be useful, but they are not the default maintained sync path:

- Anthropic Batch delivery mode
- message translation behavior
- message reprocess
- provider-specific branches that are not required for the default streaming path

They should stay behind clear adapters or explicit gates.

## 7. Verification

Use these checks against the path above:

- [FIRST_CLASS_SMOKE_CHECKS.md](./FIRST_CLASS_SMOKE_CHECKS.md): operator smoke
  runbook
- `npm run verify:core`: default pre-deploy local gate for maintained chat-path
  work
- `npm run ops:smoke` or `npm run ops:smoke:active`: post-deploy verification
