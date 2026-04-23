# ATR ID-Contract Backlog

Updated: 2026-04-23
Status: Active

This document is the execution backlog for changing ATR tool inputs from
sequence-number exact-match entry to request-local ID selection while preserving
the bounded source-map contract.

It exists to answer one narrow question:

- how to reduce model-side ATR tool-call mistakes without opening arbitrary raw
  transcript range access

It is not:

- permission to allow ad-hoc raw range requests such as `1-2` or `210-220`
- a reason to weaken source-map provenance or bounded fetch auditing
- a carryover or second-memory queue
- a Google explicit-cache queue in disguise
- a budget-tuning pass for ATR fetch count or message count

## Working Rules

- Keep ATR request-local and bounded to the current `sourceMap`.
- Replace numeric range entry with selection IDs, not with free-form range input.
- Preserve server-side exact range resolution and existing budget enforcement.
- Keep `startSeq/endSeq` visible in tool results and debug surfaces even if the
  model no longer sends them.
- Land schema, runner prompt, policy, and regression coverage together in each
  slice.
- Do not widen non-chat memory behavior or ATR carryover in this queue.

## Why This Queue Exists

Current ATR tool calls require the model to copy exact `startSeq/endSeq` or
`parentStartSeq/parentEndSeq` pairs from surfaced ranges.

That keeps the server contract tight, but it creates avoidable model-side
failure modes:

- the model has to retype coordinates instead of choosing among bounded options
- blocked tool calls consume budget and can waste the only useful recall step
- `expand_source_range` is cognitively closer to choosing one surfaced parent,
  but the current contract still presents it as exact numeric entry

The goal of this queue is to keep the boundedness while making the model-facing
interface look like selection instead of coordinate transcription.

## Acceptance Bar

This queue is only successful if all of the following become true:

1. The model can select ATR direct-fetch ranges and navigation parents through
   request-local IDs instead of exact sequence numbers.
2. The server still resolves every ID to one exact bounded range from the current
   `sourceMap`; arbitrary raw range access remains impossible.
3. Tool results and debug info still expose the resolved `startSeq/endSeq` so
   operators can audit what was actually fetched or expanded.
4. The ATR prompt and tool descriptions present the task as bounded selection,
   not numeric copy work.
5. Unknown or stale IDs fail closed with explicit blocked reasons and preserved
   budget semantics.

## P0 Execution Order

### P0-1. Define Request-Local ATR Selection IDs

Status: `completed`

Primary scope:

- `src/lib/experimental/agentic-transcript-recall/source-map.ts`
- adjacent ATR types and docs

Acceptance notes:

- direct-fetch ranges expose deterministic request-local IDs
- navigation parents expose deterministic request-local IDs
- expanded child ranges expose deterministic request-local IDs
- IDs do not imply persistent storage or cross-turn stability

Evidence:

- `src/lib/experimental/agentic-transcript-recall/source-map.ts`
- `src/lib/experimental/agentic-transcript-recall/source-map.test.ts`
- `src/app/api/internal/chat-job-runner/execution-context.test.ts`

### P0-2. Switch Tool Schemas And Resolvers To ID Input

Status: `pending`

Primary scope:

- `src/lib/experimental/agentic-transcript-recall/tool.ts`
- `src/lib/experimental/agentic-transcript-recall/expand-tool.ts`
- `src/lib/experimental/agentic-transcript-recall/policy.ts`

Acceptance notes:

- `fetch_source_range` accepts `rangeId` instead of `startSeq/endSeq`
- `expand_source_range` accepts `parentId` instead of numeric coordinates
- server resolution still maps every ID to one exact bounded range
- blocked reasons clearly distinguish unknown ID vs unavailable range vs budget
  issues

### P0-3. Reframe Runner Prompt And Debug Around Selection

Status: `pending`

Primary scope:

- `src/lib/experimental/agentic-transcript-recall/runner.ts`
- ATR debug surfaces and tests

Acceptance notes:

- runner instructions describe choosing surfaced IDs rather than copying numbers
- tool results continue returning resolved range coordinates for auditability
- debug info remains useful for diagnosing ATR mistakes after the schema switch
- no prompt/tool mismatch is introduced for requests that expose only one of the
  two ATR tools

### P0-4. Verify The Bounded Contract Still Holds

Status: `pending`

Primary scope:

- ATR regression coverage
- full-suite verification and deploy follow-up if implementation lands

Acceptance notes:

- tests cover successful direct fetch by ID
- tests cover successful parent expansion by ID
- tests cover blocked unknown IDs and stale request-local IDs
- closure uses full-suite evidence, not only targeted ATR tests
- if runner/internal route behavior changes in production, use
  `npm run ops:smoke:active` before archive

## Explicitly Out Of Scope

- arbitrary user/model-authored transcript coordinates
- persistent or cross-turn ATR IDs
- changing ATR fetch/expand budgets unless the ID contract strictly requires it
- summary/fact sourcing changes beyond what is needed to expose request-local IDs
- explicit-memory or carryover follow-ups

## End Condition

Stop when ATR keeps its bounded server contract, but the model-facing tool
workflow is selection-based rather than exact numeric entry.
