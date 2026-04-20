# Shared Sealed Memory Hierarchy Backlog

Updated: 2026-04-20
Status: Archived

This is the current execution backlog for unifying sealed-memory artifact
generation across `summary_window` and `prefix_live_blocks`.

It supersedes
[experimental-agentic-transcript-recall-phase-2-backlog-2026-04-20.md](../archive/2026/experimental-agentic-transcript-recall-phase-2-backlog-2026-04-20.md)
as the active queue because the next blocking problem is no longer only an ATR
tool-loop issue.

The deeper problem is that `prefix_live_blocks` currently persists sealed
summaries and facts using `sealEveryMessages - retainTailMessages` boundaries.
With default settings that produces ranges such as `1-96`, `97-192`, and so on.

That collides with two other contracts that already exist elsewhere:

- the canonical summary hierarchy is chunk `1-10`, `11-20`, ... then meta
  `1-100`, `101-200`, ...
- ATR assumes that smaller bounded child ranges can exist under a larger parent
  range and be fetched directly under a small message budget

This queue exists to make the sealed-memory artifact hierarchy canonical across
memory modes while keeping context exposure mode-specific.

See [SUPPORT_BOUNDARIES.md](../../SUPPORT_BOUNDARIES.md) for the support
doctrine,
[experimental-agentic-transcript-recall.md](../../experimental-agentic-transcript-recall.md)
for the current ATR contract, and
[memory-modes-v1.md](../../memory-modes-v1.md) for the existing memory-mode
design note.

## Hard Rules

- Treat raw projected transcript as the source of truth.
- Treat malformed or non-canonical summary/fact rows as disposable artifacts,
  not as records to patch in place.
- Keep `summary_window` and `prefix_live_blocks` free to differ in recent raw
  context policy.
- Do not let `summary_window` and `prefix_live_blocks` diverge in persisted
  sealed-memory artifact shape.
- Keep canonical sealed ranges fixed-size and deterministic.
- Do not make chat generation depend on a backfill having already completed.
- Do not turn this queue into transcript search, embeddings work, or a new core
  memory architecture rewrite.
- Every behavior change lands with targeted regression coverage in the same
  change.

## Assumptions Locked For This Queue

- canonical chunk size remains `10`
- canonical meta range remains `10` chunk summaries, so `1-100`, `101-200`,
  ...
- fact rows should align to the same canonical chunk boundaries as chunk
  summaries
- `prefix_live_blocks` keeps its raw-live behavior and tail-retention contract
- artifact generation cutoff and prompt-visibility cutoff are separate concerns
- a purge-and-rebuild backfill is acceptable because raw transcript remains
  available
- existing `1-96`, `97-...`, and similarly malformed ranges may be deleted
  rather than repaired

## Why This Queue Exists

The current system mixes two different ideas:

- how long raw conversation stays visible in prompt context
- how sealed memory artifacts are written to the database

`summary_window` already behaves like the desired canonical hierarchy:

- fixed `10`-message chunk summaries/facts
- `100`-message meta summaries

`prefix_live_blocks` does not.

It currently uses the prefix sealing boundary as the persisted chunk boundary,
which means:

- summaries and facts stop matching the canonical `10`-message hierarchy
- ATR loses reliable small child ranges under large parent summaries
- mixed chats can accumulate memory artifacts that are valid enough to render
  but invalid for reliable recall and future reasoning

## Desired End State

At the end of this queue:

1. both memory modes write the same canonical sealed hierarchy to
   `chat_summaries` and `chat_facts`
2. `summary_window` keeps consuming that hierarchy the same way it does now
3. `prefix_live_blocks` keeps its raw-live contract, but it no longer invents
   its own persisted chunk sizes
4. `prefix_live_blocks` may generate sealed artifacts before it chooses to
   expose them in prompt context
5. ATR can rely on canonical direct-fetch child ranges regardless of memory mode
6. affected chats can be purged and rebuilt from raw transcript without manual
   row surgery

## Priority Order

### P3-1. Lock The Canonical Sealed-Memory Contract

Why first:

- the main bug is contractual before it is mechanical
- generation boundaries, visibility boundaries, ATR assumptions, and backfill
  rules all depend on the same contract

Primary scope:

- [memory-modes-v1.md](/home/tmdduq96kr/projects/rebel-ai/docs/memory-modes-v1.md)
- [experimental-agentic-transcript-recall.md](/home/tmdduq96kr/projects/rebel-ai/docs/experimental-agentic-transcript-recall.md)
- this backlog

Done when:

- canonical chunk/fact/meta ranges are written down explicitly
- `summary_window` and `prefix_live_blocks` are defined as sharing the same
  sealed-memory artifact hierarchy
- prompt visibility is explicitly separated from artifact generation
- the queue states that malformed old ranges are purge-and-rebuild candidates,
  not in-place migration targets

### P3-2. Extract A Shared Sealed-Memory Writer

Why next:

- the repo already has a workable fixed-chunk summary pipeline, but it is owned
  by the `summary_window` path instead of a shared sealed-memory writer

Primary scope:

- [src/lib/chat-summaries/index.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/index.ts)
- [src/lib/chat-summaries/chunk-summarizer.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/chunk-summarizer.ts)
- [src/lib/chat-summaries/meta-summarizer.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/meta-summarizer.ts)
- any new shared sealed-memory orchestration module under
  [src/lib/chat-summaries](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries)

Done when:

- one shared writer can:
  - inspect projected transcript
  - create missing canonical chunk summaries
  - create aligned fact rows
  - create canonical meta summaries
- the shared writer no longer depends on `summary_window` context assembly
- chunk sizing is fixed by canonical hierarchy, not by prefix sealing settings

### P3-3. Rewire `summary_window` To Delegate Generation, Not Ownership

Why now:

- once a shared writer exists, `summary_window` should stop being the hidden
  owner of sealed-memory artifact generation

Primary scope:

- [src/lib/chat-memory/index.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory/index.ts)
- [src/lib/chat-memory/summary-window.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory/summary-window.ts)
- generation/update tests for the summary path

Done when:

- `summary_window` still consumes summaries exactly as before
- summary generation is delegated to the shared writer
- there is no behavior regression in the public-safe fallback path

### P3-4. Rewire `prefix_live_blocks` To Use The Shared Writer

Why here:

- this is the point where the bad `1-96` style artifacts stop being created

Primary scope:

- [src/lib/chat-memory/prefix-live-blocks.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory/prefix-live-blocks.ts)
- prefix memory update tests

Done when:

- `prefix_live_blocks` no longer writes chunk/fact rows sized by
  `sealEveryMessages - retainTailMessages`
- prefix updates still honor raw-live and tail-retention behavior
- prefix summary generation uses canonical `10`-chunk / `100`-meta hierarchy

### P3-5. Add A Prefix-Specific Visibility Cutoff

Why after the writer rewrite:

- generation and visibility must separate cleanly before prompt behavior can be
  trusted

Primary scope:

- [src/lib/chat-memory/prefix-live-blocks.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory/prefix-live-blocks.ts)
- [src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx)
- memory plan tests

Done when:

- sealed artifacts may exist before they are surfaced in prefix prompt context
- prefix context keeps its existing "do not surface too early" intent
- the chosen visibility rule is explicit, for example:
  - first completed meta range only, or
  - another clearly bounded prefix cutoff
- the UI copy no longer implies that persisted chunk boundaries are the same as
  the raw sealing boundary

### P3-6. Add Purge-And-Rebuild Backfill Tooling

Why before cleanup:

- affected chats already contain non-canonical rows
- mixed old/new hierarchies would keep poisoning ATR and future memory behavior

Primary scope:

- new maintainer-only script under
  [scripts/](/home/tmdduq96kr/projects/rebel-ai/scripts)
- optional supporting helpers under
  [src/lib/chat-summaries](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries)

Done when:

- one tool can detect non-canonical summary/fact hierarchies for a chat
- one tool can purge `chat_summaries` and `chat_facts` for a chat safely
- one tool can rebuild canonical artifacts from raw transcript
- the tool is idempotent and safe to rerun
- malformed old ranges such as `1-96` are deleted, not transformed

### P3-7. Re-Verify ATR Against Both Memory Modes

Why last:

- the queue is only successful if ATR stops depending on `summary_window`
  accidentally

Primary scope:

- ATR source-map tests
- memory update tests
- targeted smoke prompts and maintainer verification notes

Done when:

- ATR can discover canonical child ranges under both memory modes
- `expand_source_range` no longer returns empty only because prefix persisted a
  giant sealed chunk
- manual smoke checks cover:
  - exact older detail in `summary_window`
  - exact older detail in `prefix_live_blocks`
  - a chat rebuilt from purge-and-rebuild backfill

## Explicitly Parked

Do not pull these into this backlog unless the contract document changes:

- arbitrary free-form transcript search
- vector or embedding retrieval over raw transcript
- mode-specific summary schemas
- in-place mutation of malformed `1-96` style rows
- user-facing citation browser UI
- any change that makes ATR or summaries required for core chat success

## Default Execution Rule

If a work item does not help separate:

- canonical sealed-memory artifact generation
- mode-specific prompt visibility

then it does not belong in this queue.
