# Character-Chat ATR Gate Backlog

Updated: 2026-04-22
Status: Archived (Completed)

Completion note:

- `P0-1` through `P0-4` completed on `2026-04-22`
- the gate contract now returns `auto` vs `required` tool-choice intent with
  heuristic source/version metadata and rule hit/block traces
- character-chat heuristic v0 now forces ATR tool usage only for a narrow set of
  older exact-recall cases and defers reset / new-AU / immediate-continuation
  requests
- request-stage ATR invocations now apply forced tool use only on the first ATR
  step, then release later steps back to normal model generation
- Anthropic ATR forced-tool turns now disable incompatible thinking options for
  that invocation only
- request debug metrics and persisted `debug_info` now surface both the
  heuristic preflight decision and whether forced tool choice was actually
  applied

This document was the execution backlog for adding a thin
character-chat-specific ATR preflight that can force an ATR tool call when
older exact source detail is likely to materially change the next reply.

This queue answered two narrower questions:

- how to add a high-precision ATR gate for character chat without inventing a
  second memory system
- how to keep that gate replaceable by a later small policy model or hybrid
  policy layer

It was not:

- a general scene-state planner
- a new memory artifact, carryover, or persistence queue
- a reason to widen ATR beyond its experimental exact-source role
- a reason to move recent-raw continuity ownership away from the existing
  `summaries + recent raw + ATR` split

## Working Rules

- Keep v0 high-precision and yes-only. If the heuristic is unsure, defer to the
  normal model path.
- Keep the input surface thin. Start from the latest user message, the latest
  assistant message, and cheap ATR-availability metadata.
- Treat request-stage tool forcing as an invocation policy seam, not as a new
  memory mode.
- Every behavior change in this queue ships with direct regression coverage in
  the same change.

## Why This Queue Existed

RebelAI's ATR doctrine is already clear: ATR is the bounded exact-source
recovery path when summaries are not specific enough. The next useful step was
not a larger memory architecture change. It was a thin admission policy layer
that can force a tool-capable ATR turn in the small set of character-chat cases
where getting older exact detail wrong would visibly break continuity.

That meant the first slice stayed deliberately narrow:

- no scene-summary or relationship-summary interpreter yet
- no persistent carryover state
- no model training or distillation work yet
- only a replaceable gate contract, heuristic v0, request-stage wiring, and
  debug/test coverage

## P0 Execution Order

### P0-1. Add A Replaceable Gate Contract

Status: `completed`

Primary scope:

- a new ATR gate module under `src/lib/experimental/agentic-transcript-recall/`
- contract types that can later be reused by a heuristic, model, or hybrid gate

Acceptance notes:

- the contract returns `auto` vs `required` tool-choice intent
- the contract records rule hits / blocks and a versioned source label
- the v0 input stays thin and does not require new runtime state

### P0-2. Ship Character-Chat Heuristic V0

Status: `completed`

Primary scope:

- high-precision force cases such as older exact wording recall, older
  promise/boundary recall, and older contradiction checks
- hard defer cases such as reset / new AU and pure immediate continuation or
  style-only prompts

Acceptance notes:

- the heuristic should not try to solve full scene-state continuity
- if the match is weak or ambiguous, defer to the normal model path

### P0-3. Wire Required Tool Choice At Request Stage

Status: `completed`

Primary scope:

- [src/app/api/internal/chat-job-runner/provider-request-stage.ts](../../../../src/app/api/internal/chat-job-runner/provider-request-stage.ts)
- the experimental ATR request wrapper seam

Acceptance notes:

- request-stage preflight decides whether the ATR invocation should keep
  `toolChoice: auto` or escalate to forced tool use
- the wiring must fail closed back to the current path if the experimental ATR
  wrapper or stream request fails

### P0-4. Add Debug Metrics And Regression Coverage

Status: `completed`

Primary scope:

- ATR gate unit tests
- request-stage regression coverage
- request debug metrics for decision source, version, score, and rule hits

Acceptance notes:

- tests cover both force and defer paths
- debug output makes it obvious when tool forcing was requested vs actually
  applied

## Deferred For Later

- scene-summary or relationship-summary inputs
- a non-binary `prefer` tier
- model-backed or hybrid ATR admission policy
- provider-specific tuning beyond current request-stage behavior
