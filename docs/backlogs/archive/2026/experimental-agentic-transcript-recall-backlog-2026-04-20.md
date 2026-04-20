# Experimental Agentic Transcript Recall Backlog

Updated: 2026-04-20
Status: Active

This document is the current execution backlog for the first implementation of
experimental agentic transcript recall.

It converts
[experimental-agentic-transcript-recall.md](../../experimental-agentic-transcript-recall.md)
into an execution queue.

This backlog exists to answer one narrow question:

- can RebelAI safely test bounded model-initiated source recall without
  widening the supported core memory contract

It is not:

- a commitment to make agentic recall first-class
- a general long-term-memory overhaul
- a justification to add semantic transcript search, transcript RAG, or
  cross-chat memory in the same queue

See [SUPPORT_BOUNDARIES.md](../../SUPPORT_BOUNDARIES.md) for the experimental
doctrine and
[experimental-agentic-transcript-recall.md](../../experimental-agentic-transcript-recall.md)
for the architecture and scope contract behind this queue.

## Hard Rules

- Treat this as `experimental` only. Default off, explicit opt-in, fail closed.
- Keep it outside `memory.mode`. Use a separate experimental config namespace.
- Do not require new durable writes in core chat tables for the MVP.
- Do not make summaries, facts, or transcript persistence depend on this path.
- Initial provider scope is `openai` only.
- Every behavior change lands with targeted regression coverage in the same
  change.
- If an item requires widening the supported core contract, stop and revise the
  architecture doc before continuing.

## Assumptions Locked For This Queue

These assumptions are part of the active queue. If any of them change, replace
this backlog instead of stretching it silently.

- config lives under `model_config.experimental.agenticTranscriptRecall`
- global kill switch exists and is default `off`
- MVP provider allowlist is `['openai']`
- `maxToolCalls = 1`
- `maxMessagesPerCall = 12`
- `maxTotalMessages = 12`
- recalled ranges must come from already surfaced summary/fact ranges
- no user-facing citation UI in this queue
- no transcript search in this queue

## Why This Queue Exists

The current summary-first path already works.
The narrow opportunity is different:

- summaries and facts preserve useful range metadata
- transcript range loading already exists
- the runner already sits on AI SDK provider calls
- the repo does not yet have a safe, isolated way to let the model re-open raw
  source text during generation

That means the right first move is not "bigger memory."
It is a bounded experiment that proves whether source recall helps enough to
justify future complexity.

## Priority Order

### P0-1. Add Config And Kill-Switch Scaffolding

Why first:

- nothing else is safe until enablement is explicit and reversible
- the queue needs a hard separation from supported memory behavior

Primary scope:

- [src/lib/chat/model-config.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/model-config.ts)
- chat settings surfaces that persist `model_config`
- [src/app/api/internal/chat-job-runner/execution-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.ts)
- one small runtime flag surface if the repo does not already expose one

Done when:

- chat config can carry `experimental.agenticTranscriptRecall`
- missing config means disabled
- a global runtime flag can hard-disable the experiment regardless of chat
  config
- unsupported providers resolve to disabled without throwing
- tests prove current behavior is unchanged when the flag is off

### P0-2. Add A No-Op Experimental Request Wrapper

Why second:

- the risky seam is the provider request stage, not the transcript fetch itself
- the repo needs a wrapper path that can fail closed before tool logic is added

Primary scope:

- [src/app/api/internal/chat-job-runner/provider-request-stage.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/provider-request-stage.ts)
- new isolated modules under
  [src/lib/experimental](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental)
- runner tests under
  [src/app/api/internal/chat-job-runner](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner)

Done when:

- the normal `streamText()` path remains the default path
- enabled `openai` chats can route through a separate experimental wrapper
- the wrapper initially performs no recall and produces the same effective chat
  behavior
- wrapper errors fall back to the current supported request path
- debug output makes it visible whether the wrapper was used or skipped

### P0-3. Publish Minimal Experimental Debug Signals

Why before real recall:

- once tool behavior begins, triage will be impossible without bounded
  visibility
- experimental paths must still be observable enough to disable confidently

Primary scope:

- existing runner debug surfaces
- any lightweight metrics or structured debug fields already used by the repo

Done when:

- one request can answer:
  - was agentic recall enabled
  - was it provider-supported
  - did the wrapper run
  - did the request fall back to standard behavior
  - why was recall skipped or blocked
- no new operator dashboard or durable experimental table is required

### P1-1. Add Source-Hint Loading For Allowed Ranges

Why next:

- the model needs a bounded set of legal recall ranges
- this is the main control that keeps the MVP auditable

Primary scope:

- new isolated loader under
  [src/lib/experimental](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental)
- read-side integration with
  [src/lib/chat-summaries/context-builder.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/context-builder.ts)
  only as needed
- summary/fact range tests

Done when:

- the experimental path can derive the allowed summary/fact ranges for one chat
- the allowed set excludes recent raw messages that are already in normal
  context
- this logic does not widen the supported `MemoryPlan` contract unless clearly
  necessary
- tests cover empty, partial, and normal long-chat cases

### P1-2. Implement `fetch_source_range` With Hard Budget Enforcement

Why after source hints:

- transcript fetch without policy is the main way this experiment grows teeth in
  the wrong direction

Primary scope:

- [src/lib/chat/turn-projection.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-projection.ts)
  for reuse or a narrower helper beside it
- new experimental tool and policy modules
- runner tests for budget and validation behavior

Done when:

- one tool exists: `fetch_source_range(startSeq, endSeq, reason)`
- the tool validates:
  - feature enabled
  - provider allowed
  - range belongs to the chat
  - range is in the allowed hint set
  - per-call and per-request budgets are respected
- tool results contain only the bounded source slice needed for generation
- invalid requests fail as blocked tool calls, not as chat-request failures

### P1-3. Wire The OpenAI MVP Tool Loop

Why now:

- only after the wrapper, source hints, and policy exist does the real recall
  experiment become safe enough to run

Primary scope:

- [src/app/api/internal/chat-job-runner/provider-request-stage.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/provider-request-stage.ts)
- experimental orchestration modules
- request-stage tests

Done when:

- enabled `openai` chats may complete a generation with zero or one recall call
- the recall result is injected only into the in-flight model context
- tool results are not persisted as normal chat messages
- a tool-loop failure cleanly falls back or completes without making the path
  required for durable success
- tests cover:
  - no recall used
  - one valid recall used
  - blocked recall request
  - wrapper fallback

### P1-4. Add A Small Evaluation Harness And Exit Report

Why last:

- this queue should end in a keep/iterate/remove decision, not in drift

Primary scope:

- a compact doc or test fixture set under `docs/` or `tests/`
- any small scripted evaluation support that stays local to this experiment

Done when:

- there is a repeatable way to compare:
  - baseline summary-only behavior
  - bounded source-recall behavior
- the comparison records:
  - quality notes
  - latency delta
  - token-cost delta
  - failure/fallback frequency
- the queue closes with a short decision note: keep, iterate, or park

## Explicitly Parked

Do not pull these into this backlog unless the contract document changes:

- transcript semantic search
- transcript embeddings or vector indexes
- recall across chats
- user-facing citations or source browser UI
- more than one provider in the initial rollout
- any change that makes recall required for core chat success
- any persistent experimental recall cache
- memory-mode redesign to absorb this feature

## Default Execution Rule

If a work item does not clearly reduce uncertainty for the bounded experiment
described above, it does not belong in this backlog.

The default sequence is:

1. ship scaffolding that proves safe isolation
2. ship one bounded OpenAI-only recall path
3. evaluate the result
4. either harden with a new contract or park the feature
