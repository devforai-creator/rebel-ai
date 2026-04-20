# Experimental Agentic Transcript Recall

Updated: 2026-04-20

This document defines the contract and pre-backlog plan for an experimental feature that lets the model selectively re-open older raw chat messages when summaries or facts are not specific enough.

This is intentionally not a new core memory mode.
It is an isolated experimental path that must be safe to break, disable, or remove without damaging the supported chat path.

## Problem Statement

The current long-chat path in RebelAI is summary-first.

- older chat history is compressed into summaries and facts
- recent chat stays raw
- the model cannot currently ask to inspect the original source messages for an older summarized range during reply generation

This is good for cost and prompt size, but it loses detail in cases where the exact source wording matters:

- precise promises, conditions, or constraints
- who said what
- small contradictions
- stylistic callbacks
- emotionally important phrasing in roleplay

The proposed experiment adds a bounded "source recall" step:

- the model sees summary/fact ranges as it does today
- if it decides raw detail is needed, it can request a limited source range
- the runtime fetches that source range and returns it as tool context
- generation then continues with that additional source material

## Support Status

This feature is `experimental`.

That means:

- default off
- explicit opt-in only
- allowed to be incomplete
- allowed to be removed if it does not justify its complexity
- not allowed to weaken `core` or `fallback` paths

This doc follows the doctrine in [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md).

## Current Position After MVP

The bounded transcript-recall MVP now exists.

The next target is not core graduation.
The next target is a narrower and more honest state:

- an official experimental feature
- opt-in only
- best-effort across ATR-capable streaming provider paths
- explicitly allowed to differ by provider/model
- still fully isolated from the supported core chat contract

This means the active contract is no longer "prove one-provider MVP only".
It is now:

- keep the feature bounded and fail-closed
- make it usable without SQL-only operator rituals forever
- allow broader experimental provider coverage without pretending it is part of the supported core
- rely on request-level debug telemetry and smoke testing for day-to-day operation

## Primary Decision

Do **not** fold this into the main memory architecture as a new first-class mode.

Instead:

- keep the current memory planner as the supported base path
- add a separate experimental recall layer after normal memory planning
- treat it as a provider-gated tool loop with hard limits
- let it fail closed back to current behavior

This is deliberate.
The experiment should be able to break on its own without forcing repairs in summaries, facts, prompt building, or durable chat state.

## Goals

- Improve long-chat answer quality when exact historical wording matters.
- Keep summary/fact memory as the default baseline.
- Allow limited model-initiated retrieval of raw source messages.
- Preserve the current supported chat path when the experiment is disabled or fails.
- Make the experiment easy to gate by chat and global runtime flag, with optional provider narrowing when needed.

## Non-Goals

- Replacing the existing summary/fact memory pipeline.
- Introducing a general-purpose agent framework into the core runtime.
- Shipping semantic transcript search in the first version.
- Changing message persistence, summary generation, or regeneration semantics.
- Guaranteeing better answers on every long chat.
- Guaranteeing identical tool-use behavior across every provider or model.

## Experimental Contract

These rules are mandatory for the first implementation.

### 1. Default Off

- The feature must be globally disabled by default.
- User-facing availability must be explicit opt-in.
- A disabled state must route directly to the current supported path.

### 2. Fail Closed

If any experimental component fails, the request must continue as if the feature did not exist.

Examples:

- tool schema mismatch
- provider does not produce tool calls
- transcript fetch fails
- recall budget exceeded
- experimental prompt text degrades behavior

Failure in the experiment must not fail the chat request unless the normal supported path would already fail on its own.

### 3. No Core Ownership

The experiment must not become the owner of:

- message acceptance
- durable message writes
- summary generation
- fact generation
- permission checks
- API key handling
- queue/job orchestration contracts

It may read existing state.
It must not become required for core state transitions.

### 4. No Destructive Writes In MVP

The MVP should not require new durable writes in the main chat tables.

Preferred MVP behavior:

- read summaries/facts/transcript
- return tool results to the running model call
- emit debug logs only through existing bounded debug surfaces

If extra telemetry is later needed, it should live in a separate experimental channel or debug structure, not in core chat persistence.

### 5. Deliberate Duplication Is Acceptable

For this experimental path, some read-side duplication is acceptable if it avoids polluting core abstractions too early.

Examples:

- re-reading summary ranges directly instead of extending the core memory contract
- using a separate experimental policy module instead of widening `MemoryPlan`

The experiment should earn its right to become more integrated later.

## Scope Contract

### In Scope For The Current Experimental Contract

- Per-chat experimental opt-in.
- Global runtime kill switch.
- Optional provider allowlist.
- Capability-based experimental provider support for streaming request paths that can carry the bounded tool loop.
- One bounded tool: fetch raw messages for a specific sequence range.
- One bounded navigation tool for large surfaced parent ranges.
- Range requests limited to ranges that are already surfaced by summaries or facts.
- Hard caps on:
  - number of tool calls
  - messages returned per call
  - total fetched messages per request
  - token/character budget
- Tool results injected only into the in-flight model context.
- Debug visibility sufficient to answer:
  - was the experiment enabled
  - did the model request a range
  - what range was fetched
  - did the request fall back to standard behavior

### Explicitly Out Of Scope For The Current Experimental Contract

- free-text transcript search
- vector retrieval over raw transcript
- automatic source expansion beyond the requested range
- transcript recall across chats
- persisted recall caches
- user-facing citation UI
- model-written memory updates based on recalled transcript
- older-turn branching or transcript rewrites
- any promise that every provider/model combination will use tools equally well

## User-Visible Product Behavior

When the experiment is enabled for a chat:

- the normal summary/fact context still loads first
- the model may decide no recall is needed
- if needed, the model may request a raw source range
- the runtime returns only the bounded source slice
- the model continues the same reply with that extra source detail

When the experiment is disabled, unsupported, or skipped:

- behavior remains the same as the current RebelAI chat path

## Proposed Isolation Model

### Configuration Boundary

Do not place this under `memory.mode`.

It should live under an explicit experimental namespace so it is visually and semantically separate from supported memory behavior.

Suggested shape:

```ts
type ExperimentalAgenticTranscriptRecallConfig = {
  enabled?: boolean
  maxToolCalls?: number
  maxMessagesPerCall?: number
  maxTotalMessages?: number
  providerAllowlist?: ChatModelProvider[]
}

type ChatExperimentalConfig = {
  agenticTranscriptRecall?: ExperimentalAgenticTranscriptRecallConfig | null
}

type ChatModelConfig = {
  alternateModels?: AlternateModelsConfig | null
  memory?: ChatMemoryConfig | null
  experimental?: ChatExperimentalConfig | null
}
```

Rules:

- missing config means disabled
- `memory` behavior remains unchanged
- missing `providerAllowlist` means "allow every ATR-capable provider path"
- unsupported providers or delivery modes are treated as disabled even when chat config says enabled

### Runtime Boundary

Keep the current flow as the source of truth:

1. load chat execution context
2. build memory plan
3. build provider payload
4. generate assistant response
5. persist the result

The experiment should wrap only step 4.

Recommended shape:

1. normal memory planning runs unchanged
2. experimental gate checks global flag, chat config, and provider allowlist
3. if disabled, use the existing `streamText()` path unchanged
4. if enabled, use an experimental tool-capable request path
5. if anything in the experimental path fails, fall back to the existing path

### Code Boundary

Prefer a dedicated module area such as:

- `src/lib/experimental/agentic-transcript-recall/`

Suggested responsibilities:

- `config.ts`: normalize chat-level experimental settings
- `policy.ts`: enforce budgets and provider gates
- `source-hints.ts`: load allowed summary/fact ranges
- `tool.ts`: tool schema and transcript fetch implementation
- `runner.ts`: experimental request orchestration around AI SDK tool calling
- `types.ts`: isolated internal types

This should remain a sidecar system, not a deep rewrite of `src/lib/chat-memory/`.

## MVP Retrieval Rules

The first version should be intentionally narrow.

### Allowed Retrieval

Only allow raw transcript fetches that stay inside bounded source ranges already
represented in summary/fact metadata for the same chat.

Phase 1 treated every surfaced range as both:

- a navigation hint
- a raw-fetch target

That was too coarse once surfaced parent ranges became larger than the raw fetch
budget.

Phase 2 splits those roles:

- small surfaced ranges such as `[Summary 1-10]` or `[11-20]` may remain direct
  raw-fetch targets
- large surfaced ranges such as `[Meta Summary 1-100]` are navigation-only
  parent ranges
- raw fetch must target a bounded child range derived from a surfaced parent,
  not the large parent itself

This keeps the experiment bounded and auditable without pretending every
surfaced parent range is directly fetchable.

### Returned Data

Return only the minimum structure needed for generation:

- start and end sequence
- ordered messages
- message role
- message text

Do not return hidden internal metadata unless it is required for rendering the tool result.

### Budget Defaults

Current experimental defaults:

- `maxToolCalls = 2`
- `maxMessagesPerCall = 12`
- `maxTotalMessages = 12`

These should remain deliberately small.
The goal is to let the model recover from one bad expansion or child-range choice
without opening the door to long uncontrolled tool loops.

## Provider Scope

Do not hard-code the feature to one provider forever.

Current direction:

- allow ATR on streaming provider paths that can carry the bounded tool loop
- keep known-incompatible delivery modes explicitly blocked
- treat provider/model differences as experimental behavior, not as a reason to force one-by-one product rollout gates

Examples of valid exclusions:

- batch-only paths that do not participate in the same request-time tool loop
- provider-specific delivery modes that bypass the normal `streamText()` orchestration contract

`providerAllowlist` should remain an optional narrowing tool.
It should not be the primary mechanism for making the feature usable.

## Failure Model

This feature should be built assuming it will misbehave during development.

Expected failure classes:

- the model ignores the tool
- the model over-requests ranges
- the model asks for the wrong range
- the tool loop adds latency without quality gain
- the recalled source still does not help
- provider-specific behavior differs more than expected

The runtime response to those failures should be boring:

- cap the behavior
- log it
- continue without experimental dependency

This is a core requirement, not an implementation detail.

## Integration Points In The Current Codebase

Relevant existing surfaces:

- current memory planning dispatcher: [src/lib/chat-memory/index.ts](../src/lib/chat-memory/index.ts)
- current summary/fact context builder: [src/lib/chat-summaries/context-builder.ts](../src/lib/chat-summaries/context-builder.ts)
- current chat runner execution context: [src/app/api/internal/chat-job-runner/execution-context.ts](../src/app/api/internal/chat-job-runner/execution-context.ts)
- current provider request stage: [src/app/api/internal/chat-job-runner/provider-request-stage.ts](../src/app/api/internal/chat-job-runner/provider-request-stage.ts)
- current transcript projection helpers: [src/lib/chat/turn-projection.ts](../src/lib/chat/turn-projection.ts)

Important current facts:

- summaries and facts already preserve `start_seq` and `end_seq`
- summaries are already rendered with visible ranges in prompt text
- transcript range loading already exists
- the runner already uses AI SDK `streamText()`

This means the experiment can be added without inventing a new storage model first.

## Recommended MVP Architecture

### Step 1. Keep Base Memory Unchanged

- keep `buildMemoryPlan()` as the supported base contract
- do not add a new first-class memory mode for this experiment
- do not make summary builders aware of experimental tool behavior

### Step 2. Add Experimental Source Hint Loader

Create an isolated read-side loader that returns:

- candidate summary ranges
- candidate fact ranges
- the cutoff window that keeps current recent raw messages excluded

This can duplicate existing summary/fact read logic if needed.

### Step 3. Add A Single Transcript Recall Tool

Suggested tool:

```ts
fetch_source_range({
  startSeq: number,
  endSeq: number,
  reason: string,
})
```

Tool-side validation must enforce:

- feature enabled
- provider allowed
- range belongs to this chat
- range is in the allowed hint set
- surfaced parent ranges that exceed raw fetch budgets are blocked with an
  explicit "expand first" reason
- range respects message-count limits
- total request budget is not exceeded

### Step 3A. Add A Navigation Tool For Large Parent Ranges

Suggested tool:

```ts
expand_source_range({
  parentStartSeq: number,
  parentEndSeq: number,
  reason: string,
})
```

Tool-side validation must enforce:

- feature enabled
- provider allowed
- parent range was surfaced in summary/fact metadata for this chat
- parent range is eligible for expansion

Tool results should return:

- the surfaced parent range
- bounded legal child ranges that may be raw-fetched next
- only metadata needed to choose a child range, not raw transcript text

### Step 4. Add Experimental Request Orchestrator

This wrapper should:

- use the normal prompt and recent messages
- append a short experimental instruction block
- expose a bounded navigation step for large parent ranges and a bounded raw
  fetch step for child ranges
- stop after a very small number of steps
- convert any orchestration failure into a clean fallback

### Step 5. Keep Persistence Unchanged

- assistant result persistence stays exactly where it is today
- tool results are not persisted as chat messages
- summaries/facts are not rewritten because recall occurred

## Success Metrics

The experiment should justify itself with evidence, not intuition, but it does
not require a heavy paired-comparison harness to remain active.

Day-to-day operating evidence should come from:

- request-level `debug_info.experimental.agenticTranscriptRecall`
- manual smoke prompts that test exact older-detail recall
- direct maintainer inspection of tool-use quality on real chats

Optional sidecar comparison tooling may still exist, but it is not a rollout gate.

## Phase Plan

### Phase 0: Contract Only

- approve this document
- do not open the implementation backlog yet

### Phase 1: Scaffolding

- add config parsing
- add global flag
- add provider gating
- add a no-op experimental wrapper path

Exit condition:

- enabling the experiment changes nothing unless the provider path is explicitly active

### Phase 2: Bounded Range Recall MVP

- implement summary/fact source hints
- implement `fetch_source_range`
- wire one small tool loop for one provider
- add bounded debug visibility

Exit condition:

- one provider can complete a chat turn with zero or one transcript recall call

### Phase 2.5: Navigation vs Fetch Split

- classify surfaced ranges as direct-fetch ranges or navigation-only parents
- add `expand_source_range`
- require large surfaced parents to expand into bounded child ranges before raw
  fetch
- keep the tool loop bounded to a small number of steps

Exit condition:

- one provider can complete a chat turn with zero tool calls, one expansion, or
  one expansion followed by one raw fetch

### Phase 3: Operational Hardening As Official Experimental

- widen support to ATR-capable streaming provider paths
- improve UI and settings ergonomics
- harden prompt guidance and debug visibility
- keep the feature opt-in and fail-closed

Exit condition:

- the feature is usable as an official experimental toggle without pretending it is supported core

## Decision Rule After MVP

After MVP, choose one:

1. remove it
2. keep it as an official experimental feature with a bounded contract
3. harden it into a supported core feature with a new contract

Do not silently let it become "kind of core" through drift.

The current intended outcome is option 2, not option 3.
If it ever graduates to core, write a new architecture document and a real operating contract.
