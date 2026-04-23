# LLM Invocation Ownership

Updated: 2026-04-23

This document is the smallest useful map of RebelAI's actual LLM invocation
cores outside the narrow first-class chat success path.

Use it to answer three questions quickly:

- what actually owns a provider call versus merely wrapping it
- which invocation surfaces are first-class, secondary, experimental, or
  compatibility-only
- where duplicated `config -> decrypt -> build model -> invoke` ceremony still
  exists

It is not a demand to force every feature through one shared execution path.

## Terms

- `invocation core`: the module that materially owns provider invocation
  semantics
- `wrapper`: an HTTP route or orchestration layer that performs auth,
  persistence, or dispatch but does not itself define the LLM call shape
- `trigger-only`: a fire-and-forget dispatcher that calls another internal
  route; not a distinct LLM core

## Real Invocation Cores

### 1. Queued Chat Runner

Classification: `first-class`

Primary owner:

- [provider-request-stage.ts](../src/app/api/internal/chat-job-runner/provider-request-stage.ts):
  model construction, provider-specific request shaping, and `streamText(...)`
  invocation

Core-adjacent ownership:

- [route.ts](../src/app/api/chat/route.ts): request wrapper, admission, queue
  submission, and provider/model resolution before enqueue
- [execution-context.ts](../src/app/api/internal/chat-job-runner/execution-context.ts):
  runner-side API key lookup and vault decrypt
- [process-job-stage.ts](../src/app/api/internal/chat-job-runner/process-job-stage.ts):
  per-job execution wrapper

Invocation primitives:

- `streamText(...)` for the default streaming chat path
- `submitAnthropicBatchJob(...)` for the non-first-class Anthropic Batch variant

Notes:

- the queue/runtime split is intentional here; duplicated ceremony across
  `route.ts`, `execution-context.ts`, and `provider-request-stage.ts` is not the
  same smell as one-off secondary routes copying the whole stack
- this is still the only maintained default chat success path; see
  [FIRST_CLASS_PATH_MAP.md](./FIRST_CLASS_PATH_MAP.md)

### 2. Summary And Memory Generation

Classification: `secondary-but-supported`

Primary owner:

- [route.ts](../src/app/api/summaries/generate/route.ts): internal authenticated
  summary entrypoint that owns work inspection, API key lookup, vault decrypt,
  model construction, and `updateMemoryState(...)` dispatch

Core execution owners:

- [index.ts](../src/lib/chat-memory/index.ts): chooses `summary_window` vs
  `prefix_live_blocks`
- [index.ts](../src/lib/chat-summaries/index.ts): canonical summary update entry
- [chunk-summarizer.ts](../src/lib/chat-summaries/chunk-summarizer.ts):
  `generateText(...)` for chunk summaries and canonical facts
- [meta-summarizer.ts](../src/lib/chat-summaries/meta-summarizer.ts):
  `generateText(...)` for higher-level summaries

Wrapper and trigger-only surfaces:

- [post-generation-followups.ts](../src/app/api/internal/chat-job-runner/post-generation-followups.ts):
  best-effort summary scheduling wrapper
- [summary-trigger.ts](../src/lib/chat/summary-trigger.ts): internal route
  dispatch with retries and health tracking

Notes:

- summary is intentionally outside the first-class chat success contract
- the internal route already behaves like its own invocation core, not just a
  thin wrapper

### 3. Translation

Classification: `secondary-but-supported`

Primary owner:

- [translation-service.ts](../src/lib/chat/translation-service.ts):
  provider/model resolution, vault decrypt, `buildLanguageModel(...)`, and
  `generateText(...)`

Wrappers:

- [route.ts](../src/app/api/messages/translate/route.ts): user-facing translate
  route
- [route.ts](../src/app/api/internal/translate-message/route.ts): internal
  translate route

Trigger-only surfaces:

- [post-submit-effects.ts](../src/app/api/chat/post-submit-effects.ts): route-side
  best-effort trigger wrapper
- [translation-trigger.ts](../src/lib/chat/translation-trigger.ts):
  fire-and-forget internal route dispatcher

Notes:

- translation already has one obvious invocation owner
- the wrapper count is higher than the core count, which makes this area look
  more fragmented than it really is

### 4. Message Reprocess

Classification: `experimental`

Primary owner:

- [route.ts](../src/app/api/messages/reprocess/route.ts): resolves config,
  decrypts the API key, builds the model, invokes `streamText(...)`, and writes
  partial updates back to the existing message row

Notes:

- this is the clearest one-file copy of the non-chat invocation ceremony
- the route is both wrapper and invocation owner today

### 5. Embeddings

Classification: `secondary-but-supported provider sidecar`

Primary owner:

- [embeddings.ts](../src/lib/embeddings.ts): profile/API key lookup, vault
  decrypt, Voyage client creation, and `embed(...)`

Notes:

- this is not a chat text-generation path and should not be force-fit into the
  same helper shape as `streamText(...)` or `generateText(...)`
- it still matters for invocation ownership because it is another provider call
  surface with secret access and model/client setup

### 6. Anthropic Batch Delivery Variant

Classification: `secondary delivery variant` and `explicitly not first-class`

Primary owner:

- [anthropic-batch-orchestrator.ts](../src/app/api/internal/chat-job-runner/anthropic-batch-orchestrator.ts):
  batch request submission and result polling/storage

Entrypoint:

- [provider-request-stage.ts](../src/app/api/internal/chat-job-runner/provider-request-stage.ts):
  branches into `submitAnthropicBatchJob(...)` when delivery mode requests it

Notes:

- this is not a separate top-level product surface
- it is a provider-specific variant of queued chat execution and should stay
  secondary to the default streaming path

## Wrapper And Trigger-Only Surfaces

These files matter operationally, but they should not be mistaken for separate
LLM invocation cores.

- [route.ts](../src/app/api/chat/route.ts): request admission, queueing, and
  delivery-mode selection before the runner
- [route.ts](../src/app/api/internal/chat-job-runner/route.ts): authenticated
  runner HTTP entry
- [process-job-stage.ts](../src/app/api/internal/chat-job-runner/process-job-stage.ts):
  per-job wrapper around the execution stages
- [post-generation-followups.ts](../src/app/api/internal/chat-job-runner/post-generation-followups.ts):
  best-effort post-generation scheduling
- [summary-trigger.ts](../src/lib/chat/summary-trigger.ts): summary dispatch to
  the internal summaries route
- [post-submit-effects.ts](../src/app/api/chat/post-submit-effects.ts):
  translation dispatch after enqueue
- [translation-trigger.ts](../src/lib/chat/translation-trigger.ts): translation
  dispatch to the internal translate route
- [route.ts](../src/app/api/messages/translate/route.ts): auth/rate-limit wrapper
  around the translation service
- [route.ts](../src/app/api/internal/translate-message/route.ts): internal auth
  wrapper around the same translation service

## Repeated Setup Ceremony

The duplicated setup worth caring about is not “anything that eventually causes
an LLM call.” It is the repeated ownership of this sequence:

`resolve config -> decrypt secret -> build model/client -> invoke`

### Clear Duplicates

1. Summary route

- config and work inspection: [route.ts](../src/app/api/summaries/generate/route.ts)
- vault decrypt: [route.ts](../src/app/api/summaries/generate/route.ts)
- model build: [route.ts](../src/app/api/summaries/generate/route.ts)
- downstream invoke: [chunk-summarizer.ts](../src/lib/chat-summaries/chunk-summarizer.ts),
  [meta-summarizer.ts](../src/lib/chat-summaries/meta-summarizer.ts)

2. Translation service

- config resolve: [translation-service.ts](../src/lib/chat/translation-service.ts)
- vault decrypt: [translation-service.ts](../src/lib/chat/translation-service.ts)
- model build and invoke: [translation-service.ts](../src/lib/chat/translation-service.ts)

3. Reprocess route

- config resolve: [route.ts](../src/app/api/messages/reprocess/route.ts)
- vault decrypt: [route.ts](../src/app/api/messages/reprocess/route.ts)
- model build and invoke: [route.ts](../src/app/api/messages/reprocess/route.ts)

### Intentional Or Different Duplicates

1. Queued chat runner

- config resolve in [route.ts](../src/app/api/chat/route.ts)
- vault decrypt in [execution-context.ts](../src/app/api/internal/chat-job-runner/execution-context.ts)
- model build and invoke in
  [provider-request-stage.ts](../src/app/api/internal/chat-job-runner/provider-request-stage.ts)

This split is tied to the queue/runtime boundary and should not be flattened
casually.

2. Embeddings

- profile/API key lookup and vault decrypt in [embeddings.ts](../src/lib/embeddings.ts)
- provider client creation and `embed(...)` invocation in the same file

This is a different provider primitive and should probably stay outside any
shared text-generation helper.

## P0-1 Findings

1. RebelAI does not have “one LLM route too many.” It has about five real
   invocation cores plus one provider-specific delivery variant.
2. The repo looks more fragmented than it really is because several wrappers and
   trigger dispatchers sit around a smaller number of actual invocation owners.
3. Translation is already in relatively good shape because both HTTP routes
   converge into one service owner.
4. Reprocess is the clearest one-off duplication target.
5. Summary/memory is the most important secondary surface to keep explicit,
   because it is both real product work and structurally separate from the
   first-class queued chat path.

## Recommended P0-2 Direction

The next extraction should be narrow:

- do **not** try to unify queued chat, summary, translation, reprocess, and
  embeddings under one execution framework
- do extract a small non-chat helper seam for repeated text-generation setup
  where it is genuinely duplicated

The best candidates are:

- summary route
- translation service
- reprocess route

The queued chat runner and embeddings path should stay separate unless a later
slice shows a stronger reason to merge their setup.

## P0-2 Outcome

The extracted shared seam is intentionally small:

- [language-model-access.ts](../src/lib/llm/language-model-access.ts): shared
  non-chat helper for `vault decrypt -> build model`

Adopted callers:

- [translation-service.ts](../src/lib/chat/translation-service.ts)
- [route.ts](../src/app/api/messages/reprocess/route.ts)
- [route.ts](../src/app/api/summaries/generate/route.ts)

Still intentionally local:

- config resolution and product-specific ownership decisions
- actual `generateText(...)` or `streamText(...)` invocation semantics
- queued chat runner secret/model setup
- embeddings client setup

## P0-3 Outcome

Secondary invocation ownership is now clearer at the boundary:

- translation keeps [translation-service.ts](../src/lib/chat/translation-service.ts)
  as the invocation owner, while route-specific response mapping moved into
  [translation-route-response.ts](../src/lib/chat/translation-route-response.ts)
- summary route entry now delegates invocation ownership to
  [summary-generation-service.ts](../src/lib/chat-memory/summary-generation-service.ts)
- reprocess route entry now delegates invocation ownership to
  [reprocess-service.ts](../src/lib/chat/reprocess-service.ts)

That keeps wrappers and triggers visibly thinner without coupling the first-class
queued chat runner to secondary-path semantics.

## Explicitly Out Of Scope For This Queue

These provider calls exist, but they are not part of the current ownership
cleanup target:

- maintenance scripts such as `scripts/backfill-facts.js`
- maintenance scripts such as `scripts/backfill-embeddings.js`
- test-only invocation mocks
