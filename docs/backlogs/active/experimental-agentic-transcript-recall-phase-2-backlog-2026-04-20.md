# Experimental Agentic Transcript Recall Phase 2 Backlog

Updated: 2026-04-20
Status: Active

This document is the current execution backlog for phase 2 of experimental
agentic transcript recall.

It supersedes
[experimental-agentic-transcript-recall-backlog-2026-04-20.md](../archive/2026/experimental-agentic-transcript-recall-backlog-2026-04-20.md),
which proved the bounded MVP path and surfaced the next concrete problem:

- large surfaced parent ranges such as `[1-100]` or `[201-300]` are useful
  navigation hints
- those same parent ranges are not directly fetchable under the current
  per-call budget
- exact-match-only fetch policy prevents the model from drilling into smaller
  child ranges such as `[211-220]`

This queue exists to fix that contract without turning experimental recall into
general transcript search.

See [SUPPORT_BOUNDARIES.md](../../SUPPORT_BOUNDARIES.md) for the experimental
doctrine and
[experimental-agentic-transcript-recall.md](../../experimental-agentic-transcript-recall.md)
for the current architecture note behind this feature.

## Hard Rules

- Treat this as `experimental` only. Default off, explicit opt-in, fail closed.
- Keep it outside `memory.mode`. Use the existing experimental config namespace.
- Keep `fetch_source_range` bounded and read-only.
- Do not widen this queue into transcript search, transcript RAG, embeddings, or
  cross-chat memory.
- Do not make summaries, facts, or transcript persistence depend on this path.
- Keep provider scope at `openai` only for this queue.
- Do not "fix" large parent ranges by simply raising `maxMessagesPerCall` until
  the whole parent range fits.
- Every behavior change lands with targeted regression coverage in the same
  change.

## Assumptions Locked For This Queue

These assumptions are part of the active queue. If any of them change, replace
this backlog instead of stretching it silently.

- config remains under `model_config.experimental.agenticTranscriptRecall`
- global kill switch remains default `off`
- MVP provider allowlist remains `['openai']`
- `fetch_source_range` stays as the raw transcript fetch primitive
- a second tool is allowed for navigation, tentatively
  `expand_source_range(parentStartSeq, parentEndSeq)`
- surfaced parent ranges may be `summary`, `meta_summary`, or
  `super_meta_summary`
- only derived child ranges may be fetchable; this queue does not allow
  arbitrary free-form subrange fetches
- target tool budget becomes two-step and remains bounded
  - one navigation step
  - one raw fetch step
- `maxMessagesPerCall` and `maxTotalMessages` remain bounded at the current
  scale unless a later evaluation proves a tighter change is necessary
- no user-facing citation browser or transcript inspector in this queue

## Why This Queue Exists

Phase 1 answered the first question:

- can RebelAI safely expose one bounded model-initiated transcript recall tool

The answer is yes, but it exposed a real design flaw:

- the model can see parent ranges that are meaningful for navigation
- the current policy only allows exact surfaced ranges
- large surfaced ranges are often impossible to fetch under the same bounded
  fetch budget

That means the current queue must split two concepts that phase 1 treated as
the same thing:

- navigation ranges
- fetchable source ranges

## Desired End State

At the end of this queue, the model should be able to do this safely:

1. notice that a user question depends on precise older wording or scene detail
2. use a surfaced parent range as a navigation hint
3. expand that parent into smaller allowed child ranges
4. fetch one bounded child range
5. answer using the fetched raw source without widening the supported core
   memory contract

## Priority Order

### P2-1. Lock The Navigation vs Fetch Contract

Why first:

- the main bug is contractual, not implementation-only
- tool names, policy, and eval all depend on this distinction

Primary scope:

- [docs/experimental-agentic-transcript-recall.md](/home/tmdduq96kr/projects/rebel-ai/docs/experimental-agentic-transcript-recall.md)
- this backlog
- experimental policy modules under
  [src/lib/experimental/agentic-transcript-recall](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall)

Done when:

- parent ranges are explicitly defined as navigation-only when they exceed raw
  fetch budgets
- child ranges are explicitly defined as the only fetchable raw ranges
- the queue names the new navigation tool and its exact output shape
- the queue defines what counts as a legal child range
  - existing summary chunk range
  - existing fact range
  - or another bounded derived unit
- failure behavior is explicit when a parent range has no eligible child ranges

### P2-2. Build A Bounded Source Map For Child Range Expansion

Why next:

- the model cannot drill down safely unless the server can precompute the legal
  children of each surfaced parent

Primary scope:

- [src/lib/experimental/agentic-transcript-recall/source-hints.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall/source-hints.ts)
- new isolated source-map modules under
  [src/lib/experimental/agentic-transcript-recall](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall)
- summary/fact range derivation tests

Done when:

- execution context can derive a parent -> child source map for one chat
- child ranges stay bounded and deterministic
- child ranges exclude recent raw messages already present in normal context
- duplicate or overlapping child ranges are handled predictably
- tests cover:
  - no summaries
  - only direct summary chunks
  - meta summary parents with multiple eligible children
  - parents whose children are partially or fully inside recent raw context

### P2-3. Add `expand_source_range` As A Navigation Tool

Why after the source map:

- the model needs a bounded way to inspect the legal child ranges of a surfaced
  parent before choosing one raw fetch

Primary scope:

- new tool module beside
  [tool.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall/tool.ts)
- source-map integration
- targeted tool tests

Done when:

- one navigation tool exists:
  `expand_source_range(parentStartSeq, parentEndSeq, reason)`
- the tool validates:
  - feature enabled
  - provider allowed
  - parent range was surfaced in prompt
  - parent range is eligible for expansion
- tool results return only bounded child-range metadata, not raw transcript text
- invalid expansion attempts fail as blocked tool calls, not as chat-request
  failures

### P2-4. Redefine Fetch Policy Around Allowed Child Ranges

Why here:

- once navigation exists, exact-match-on-parent is the wrong fetch contract

Primary scope:

- [src/lib/experimental/agentic-transcript-recall/policy.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall/policy.ts)
- [src/lib/experimental/agentic-transcript-recall/tool.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall/tool.ts)
- policy tests and tool tests

Done when:

- `fetch_source_range` accepts only allowed child ranges
- parent ranges can be blocked from direct raw fetch with a specific reason
- navigation and fetch budgets are explicit and separately testable
- blocked reasons distinguish:
  - parent range requires expansion first
  - range is not a legal child range
  - range exceeds raw fetch budget
- tests cover both the old exact-match path that should now fail and the new
  expand-then-fetch path that should succeed

### P2-5. Wire A Two-Step OpenAI Tool Loop

Why now:

- only after contract, source map, and policy exist does the model have a sane
  way to navigate large parent ranges

Primary scope:

- [src/lib/experimental/agentic-transcript-recall/runner.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/experimental/agentic-transcript-recall/runner.ts)
- [src/app/api/internal/chat-job-runner/provider-request-stage.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/provider-request-stage.ts)
- request-stage tests

Done when:

- runner instructions distinguish navigation ranges from raw fetch ranges
- the model may complete a reply with:
  - zero tool calls
  - one expansion only
  - one expansion plus one fetch
- tool-loop failures still fail closed and preserve the experimental boundary
- tests cover:
  - no recall used
  - expansion used but no raw fetch needed
  - expansion followed by valid fetch
  - invalid direct parent fetch blocked
  - wrapper fallback

### P2-6. Extend Debug Signals

Why before rollout confidence:

- once there are two tools, the current debug surface is too coarse to explain
  model behavior or policy failures

Primary scope:

- runner debug surfaces
- optional sidecar references only:
  [docs/experimental-agentic-transcript-recall-eval.md](/home/tmdduq96kr/projects/rebel-ai/docs/experimental-agentic-transcript-recall-eval.md),
  [scripts/run-agentic-transcript-recall-eval.js](/home/tmdduq96kr/projects/rebel-ai/scripts/run-agentic-transcript-recall-eval.js)

Done when:

- one request can answer:
  - was expansion available
  - was expansion called
  - how many child ranges were returned
  - which child range was selected for raw fetch
  - whether the model attempted an invalid direct parent fetch first
- optional local comparison tooling may stay dormant
- this queue does not require paired baseline-vs-experimental reporting before
  moving forward

## Explicitly Parked

Do not pull these into this backlog unless the contract document changes:

- arbitrary free-form transcript search
- embeddings or vector indexes
- cross-chat recall
- user-facing source browser UI
- automatic multi-hop traversal across many parent ranges in one reply
- any change that makes recall required for core chat success
- any change that stores expanded child maps as required durable state

## Default Execution Rule

If a work item does not help separate navigation ranges from fetchable raw
source ranges under a bounded experimental contract, it does not belong in this
queue.
