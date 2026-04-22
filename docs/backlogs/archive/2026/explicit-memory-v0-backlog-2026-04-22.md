# Explicit Memory V0 Backlog

Updated: 2026-04-22
Status: Archived (Parked)

Parking note:

- drafted on `2026-04-22` as a possible next-step design queue after recent ATR
  hardening
- intentionally parked the same day without implementation because ATR has only
  recently crossed into the current heuristic/tool-choice hardening phase
- revisit only after ATR behavior, telemetry, and operating confidence feel
  stable enough to absorb a second persistent memory layer

This document was the execution backlog draft for adding a first explicit
memory layer to RebelAI without displacing the current
`summaries + recent raw + ATR` contract.

This queue answers two narrower questions:

- how to add sourced persistent memory without inventing an opaque second memory
  system
- how to let the model propose durable memory writes while keeping storage,
  conflict handling, and context surfacing under product control

It is not:

- a replacement for summaries, recent raw, or ATR
- a free-form autonomous journal
- a reason to make ATR fetched raw state quietly persistent
- a reason to require extra tool calls on every turn
- a reason to broaden long-term memory into untyped scene interpretation

## Working Rules

- Keep `summaries + recent raw + ATR` as the first-class long-chat path.
- Keep explicit memory as a narrow, typed layer for durable facts that should
  survive compression better than summaries alone.
- Require provenance. Every persisted memory entry must point back to a source
  chat and source range.
- Prefer `propose` over direct model-owned `write`.
- Keep the read path cheap and deterministic in v0.
- Ship every policy change with regression coverage and eval samples.

## Why This Queue Exists

RebelAI already has durable compression and bounded exactness recovery:

- summaries and facts preserve long-history continuity
- ATR reopens bounded older source when exact detail matters

What is still missing is a small explicit layer for things like stable
preferences, promises, boundaries, and canon facts that are worth persisting as
first-class records instead of hoping they remain intact through repeated
compression.

The goal is not "more memory" in the abstract.
The goal is to add a narrow durable layer that improves long-chat reliability
without turning the system into an opaque planner or a hidden note-taking
subsystem.

## V0 Product Shape

### Intended Role

Explicit memory v0 should hold only durable, reply-shaping information that is:

- stable enough to outlive one scene
- small enough to surface cheaply
- important enough that losing it through summary drift would be visibly bad

### Allowed Kinds

Start with a deliberately small kind set:

- `preference`
- `boundary`
- `promise`
- `canon_fact`
- `user_profile`

### Deferred Kinds

Do not store these in v0:

- transient mood or current-scene emotion
- broad relationship interpretation such as "they are getting closer"
- free-form plot summaries
- stylistic preferences inferred from one turn
- speculative or contradictory interpretations that are not source-backed

## Draft Artifact Contract

V0 should introduce a new explicit-memory artifact rather than piggyback on
summary rows, facts rows, or `debug_info`.

```ts
type ExplicitMemoryScope = 'chat' | 'character'

type ExplicitMemoryKind = 'preference' | 'boundary' | 'promise' | 'canon_fact' | 'user_profile'

type ExplicitMemoryStatus = 'active' | 'superseded' | 'retracted'

type ExplicitMemoryEntry = {
  id: string
  scope: ExplicitMemoryScope
  scopeKey: string
  kind: ExplicitMemoryKind
  statement: string
  sourceChatId: string
  sourceStartSeq: number
  sourceEndSeq: number
  createdBy: 'model' | 'user' | 'system'
  admissionSource: 'tool_proposal' | 'extractor' | 'manual'
  status: ExplicitMemoryStatus
  supersedesId: string | null
  createdAt: string
  lastUsedAt: string | null
}
```

Notes:

- `scope='chat'` means durable only inside one conversation.
- `scope='character'` means durable across chats for the same character.
- `account` or `global` scope is deferred until ownership and UX are clearer.
- `statement` must be short, normalized, and human-editable.
- provenance fields are mandatory in v0.

## Draft Tool And Read Contracts

### Write Path

Use a bounded tool proposal, not a direct model-owned write:

- tool name: `propose_memory_write`
- purpose: ask the system to consider persisting one durable memory candidate

Draft arguments:

```ts
type ProposeMemoryWriteInput = {
  scope: 'chat' | 'character'
  kind: ExplicitMemoryKind
  statement: string
  sourceStartSeq: number
  sourceEndSeq: number
  supersedesStatement?: string | null
}
```

Tool rules:

- at most one proposal per turn in v0
- proposal must reference a source range inside the current chat
- proposal must be rejected if the statement is vague, emotional, or scene-local
- proposal does not guarantee persistence

### Read Path

Do not start with a model-facing read tool.
Do not add embeddings in v0.

V0 read behavior should be deterministic prompt surfacing:

- the server scores active explicit memories against the latest turn with narrow
  heuristics
- the server selects only the top few relevant memories
- those entries are injected as a compact sealed or semi-sealed memory block
- if the surfaced memory still appears insufficient or contested, ATR remains
  the exactness recovery path

V0 should stay single-lane:

- no always-on pinned memory lane
- no separate retrieval mode for "core" vs "candidate" memories
- if nothing scores clearly enough, inject nothing

Deferred:

- `search_explicit_memory`
- `list_character_memories`
- memory editing tools exposed to the model

Reason:

- read-time tool loops would add cost and prompt variance before the memory
  policy is mature
- most explicit memories should be short enough to surface directly once chosen
- a single heuristic top-k pass is easier to debug than a mixed retrieval stack

## Policy Layer For Explicit Memory

The policy layer is the logic that decides:

- whether a candidate should be saved at all
- which scope it belongs to
- whether it supersedes an older memory
- whether a stored memory should be surfaced for this turn
- whether surfaced memory is sufficient or ATR should still verify older raw

V0 should keep this policy mostly programmatic and heuristic.

### Write Admission Policy

Persist only if all are true:

- the memory kind is allowed
- the statement is source-backed and non-ephemeral
- the value is likely useful across multiple later turns
- the statement is not already covered by an active equivalent memory

Default write posture:

- `chat` scope by default
- escalate to `character` only for clearly cross-chat durable information
- reject unclear scope rather than guessing aggressively

### Conflict Policy

If a new candidate conflicts with an older active memory:

- newer source-backed direct statement wins only when conflict is explicit
- mark the older entry `superseded`, do not hard-delete it
- do not auto-supersede on weak paraphrase or emotional interpretation

### Read Admission Policy

Surface only memories that are both:

- relevant to the current turn
- low-risk to inject without distorting the scene

V0 relevance should stay narrow:

- direct keyword or semantic match to the latest user turn
- kind-specific hooks such as promises, preferences, and boundaries
- optional character-scope memories only when directly relevant
- top-k cap should stay small, such as `2-4`
- if the score is weak or ambiguous, surface nothing rather than over-inject

Suggested first scoring inputs:

- exact or near-exact lexical overlap against the latest user turn
- kind boost for `boundary`, `promise`, and `canon_fact`
- recency of last use only as a weak tie-breaker
- `superseded` memories excluded entirely

### Escalation Policy

Surfaced explicit memory is not the source of truth.

If the turn still demands exact older wording, contradiction resolution, or
scene-specific recall, policy should continue to escalate to ATR rather than
trusting the memory entry alone.

## Recommended First Implementation Shape

The repo can support a tool-call write path, but v0 should still stay modest.

Recommended v0 shape:

1. add the explicit-memory storage contract
2. add `propose_memory_write`
3. run server-side admission before commit
4. surface a tiny set of applicable explicit memories during context assembly
5. keep ATR as the verifier when exactness is still needed

This keeps the write path agentic, but keeps the read path predictable.

## Evals And Regression Plan

V0 needs repeatable evaluation for both write and read policy.

### Write Evals

Create datasets for:

- should save vs should reject
- correct kind assignment
- correct scope assignment
- duplicate rejection
- explicit contradiction and supersession

Representative prompts:

- "Remember that I hate mint chocolate."
- "We promised to meet again on the first snow."
- "She seems a little softer today."
- "Maybe he kind of likes coffee now."

Expected outcomes:

- first two can persist
- latter two should reject in v0

### Read Evals

Create datasets for:

- relevant memory surfaced
- irrelevant memory not surfaced
- character-scope memory not over-injected into unrelated scenes
- surfaced memory still leading to ATR when exact verification is required

Representative prompts:

- "What dessert did I say I hate?"
- "What promise did we make that night?"
- "Talk cute to me again."

Expected outcomes:

- first two may surface explicit memory
- third should not retrieve a random durable memory just because the turn is
  open-ended

### Trace And Tool Evals

When the write tool exists, grade traces for:

- did the model propose memory only when warranted
- did it choose the correct kind
- did it point at the correct source range
- did server admission accept or reject for the right reason

## Debug Surfaces

V0 should add operator-visible debug state for:

- whether a memory proposal was attempted
- the proposal payload after normalization
- admission result: `accepted`, `duplicate`, `rejected`, `superseded_previous`
- which explicit memories were surfaced this turn
- whether ATR was still used after explicit-memory surfacing

## P0 Execution Order

### P0-1. Define Artifact And Storage Boundary

Status: `pending`

Primary scope:

- explicit-memory types
- new storage boundary and migration
- no reuse of summary/fact rows for explicit memory

Acceptance notes:

- provenance fields are mandatory
- `chat` and `character` scopes are supported
- status lifecycle supports `active` and `superseded`

### P0-2. Add Proposal Tool And Admission Logic

Status: `pending`

Primary scope:

- `propose_memory_write` contract
- server-side validation, dedupe, and conflict handling

Acceptance notes:

- proposal is bounded to one candidate per turn
- admission can reject vague or ephemeral candidates
- accepted writes produce compact, human-readable entries

### P0-3. Surface Applicable Explicit Memories In Context Assembly

Status: `pending`

Primary scope:

- memory selection during prompt assembly
- compact formatting for surfaced memories

Acceptance notes:

- surfacing is deterministic and cheap
- unrelated memories are not injected
- explicit memory does not replace ATR for exact older recall

### P0-4. Add Debug, Tests, And Evals

Status: `pending`

Primary scope:

- unit coverage for policy functions
- request-stage or context-assembly regression tests
- first explicit-memory dataset and trace checks

Acceptance notes:

- write acceptance and rejection paths are covered
- read surfacing false positives are covered
- eval fixtures exist for both discovery and exactness-sensitive cases

## Deferred For Later

- account/global memory scope
- model-facing memory search tools
- automatic memory proposal approval UX
- user-facing memory editor and merge UI
- model-backed policy planner or reranker
- richer memory kinds such as scene summaries or relationship arcs
