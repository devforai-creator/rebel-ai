# 2026-04-20 Feature Review Follow-up Backlog

Updated: 2026-04-21
Status: Active

This document is the current execution backlog for closing the remaining code
review surface around the large feature additions that landed on
`2026-04-20`.

It answers one narrow question:

- what still needs review or follow-up hardening from the `2026-04-20`
  feature drop after the first ATR fixes landed on `2026-04-21`

It is not:

- a new feature roadmap
- a general repo cleanup queue
- a justification to redesign memory modes wholesale
- a justification to reopen already-closed ATR fixes without a new concrete
  regression

## Already Reviewed And Closed

These items were part of the `2026-04-20` feature drop, but have already been
reviewed and handled on `2026-04-21`:

- ATR config ownership and resolution cleanup:
  `1a71c6e` `Separate ATR account defaults from chat overrides`
- per-chat ATR UI relocation out of the crowded chat header surface:
  `b17b694` `Move ATR chat override into chat settings`
- ATR fail-closed behavior when source mapping is unavailable:
  `0681eaf` `Fail closed when ATR source mapping is unavailable`
- ATR bounded fetch now using projected turn windows instead of full transcript
  reloads:
  `108ae04` `Bound ATR transcript fetches to projected turn windows`
- canonical backfill and regeneration now respect episodic-RAG-off contracts and
  do not preserve stale facts:
  `b35032b` `Respect episodic memory contracts in backfill and regeneration`
- dead full-facts reads were removed from context building:
  `fed8fc0` `Drop dead fallback fact reads from context building`
- legacy transcript fallback was removed from the split chat request contract:
  `94edee5` `Remove legacy chat transcript fallback`
- chat request body size and extra-field boundaries were hardened:
  `9371fcd` `Harden chat request body boundaries`
- assistant finalization now fails closed on incomplete rollback and no longer
  supports turn-less regeneration:
  `c597c79` `Fail closed on assistant finalization rollback`
- dead post-generation summary trigger timing metrics were removed, and service
  tests now follow the turn-based regeneration contract:
  `df6ca94` `Drop dead summary trigger timing metrics`
- the dead `sealEveryMessages` prefix-memory knob was removed from current
  config writes and tests while read-side normalization remains backward-
  compatible with older rows:
  `uncommitted in current session`

This backlog therefore starts after those fixes, not before them.

## Hard Rules

- Keep this queue review-shaped. Every item should correspond to a concrete
  boundary, contract, stale-data, or unnecessary-read concern.
- Prefer closing one verified finding over broad speculative “cleanup”.
- If a suspected issue turns out to be acceptable, document that and close it
  instead of expanding scope.
- Do not silently redefine the memory contract while fixing review findings.
- Every behavior change from this queue lands with direct regression coverage in
  the same change.
- If an item touches DB schema, migrations, or generated types, follow
  [DB_CHANGE_WORKFLOW.md](../../DB_CHANGE_WORKFLOW.md).

## Why This Queue Exists

The `2026-04-20` change set mixed several things at once:

- ATR capability work
- shared sealed memory and episodic RAG changes
- canonical memory backfill tooling
- chat route and runner boundary splits

The ATR review produced real bugs quickly, which is a signal that the rest of
the same day’s feature surface should be closed out intentionally instead of
assuming the remaining areas are clean by association.

The goal here is not to keep reviewing forever.
It is to turn “there may still be boundary drift from the April 20 drop” into a
small bounded queue with explicit end conditions.

## Current Risk Map

The broad route-split and post-generation-split review passes are now closed.

The remaining review surface is narrower and more specific:

- shared sealed-memory integrity in `prefix_live_blocks`
- canonical frontier detection for malformed summary/meta rows
- the product-facing repair path when sealed-memory artifacts drift out of
  canonical shape

The first item has now been handled.
The remaining two stay active in this backlog, but they are intentionally
deferred until the product philosophy is clearer about sealed-memory repair,
fallback, and user-facing recovery.

So the next work should prioritize:

1. parking runtime frontier hardening until product doctrine is clearer
2. parking repair-surface design until product doctrine is clearer

## Priority Order

Only the remaining active work stays in this list.
Earlier `P0-1`, `P0-2`, and `P1-1` findings are closed and recorded above in
`Already Reviewed And Closed`.

### P2-2. Deferred: Canonical Frontier Helper And Gap Handling Doctrine

Why next:

- the current helper path trusts highest `end_seq`, not contiguous verified
  frontier
- malformed chunk/meta rows can blur the sealed-vs-live boundary even if raw
  transcript truth is still intact
- this can be fixed without adding hidden repair logic, request-path LLM work,
  or silent raw-context expansion

Primary scope:

- [src/lib/chat-summaries/db-helpers.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/db-helpers.ts)
- [src/lib/chat-summaries/sealed-memory-writer.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/sealed-memory-writer.ts)
- [src/lib/chat-memory/prefix-live-blocks.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory/prefix-live-blocks.ts)
- [src/app/api/internal/chat-job-runner/execution-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.ts)

Done when:

- a helper can report contiguous canonical frontier and first missing canonical
  range for chunk/meta summaries
- runtime uses validated frontier for prefix visibility cutoff
- writer/update-work decisions use validated frontier instead of bare
  `max(end_seq)`
- the helper stays read-only: no LLM calls, no queueing, no state machine
- malformed artifact chains are ignored instead of trusting bad sealed summaries
- runtime does not silently expand raw context to compensate for malformed
  sealed memory

Current status:

- keep active in the backlog
- do not implement yet
- revisit only after the product doctrine is settled on whether malformed
  sealed memory should be silently ignored, surfaced in memory UI, or paired
  with an explicit user repair action

### P2-3. Deferred: User-Triggered Targeted Repair Path

Why last:

- SQL/manual operator repair is the wrong product surface here
- full-chat rebuilds are too expensive and too blunt for long chats
- the right recovery path is explicit, bounded, chat-scoped, and user-driven

Primary scope:

- the existing memory/chunk UI surface that should expose repair when malformed
  sealed memory is detected
- a user-triggered action path for targeted canonical repair
- regeneration helpers for repairing missing chunk ranges and affected parent
  meta ranges only

Done when:

- a user can explicitly request repair for a specific malformed chunk or
  affected parent range without leaving the product
- repair is targeted to missing canonical ranges and affected parent summaries,
  not a full sealed-memory rebuild
- repair is rate-limited and deduped per chat
- request-time generation stays free of hidden repair LLM calls
- the main chat UX does not rely on global degraded banners or silent fallback;
  repair is offered where the user already inspects memory state
- the resulting UX matches the real contract: raw transcript is source of
  truth, sealed memory is repairable cache that may simply be ignored when
  malformed

Current status:

- keep active in the backlog
- do not implement yet
- revisit only after `P2-2` doctrine is settled, so repair UX is not designed
  against the wrong fallback/failure policy

## Explicitly Parked

Do not pull these into this backlog unless a concrete bug points there:

- ATR capability tuning beyond the fixes already landed on `2026-04-21`
- pure docs cleanup from `2026-04-20`
- `ChatSummariesPanel` collapse-default UI polish by itself
- debug-modal presentation cleanup by itself
- a broad long-term-memory redesign

Also explicitly out of scope for this queue unless a new concrete bug changes
the tradeoff:

- hidden request-path auto-repair of malformed sealed memory
- automatic full-chat sealed-memory rebuilds for long conversations
- silent raw-context expansion as fallback for malformed sealed memory
- SQL-only/manual-only recovery as the primary product repair path

## End Condition

This queue is done when:

1. the known memory/backfill findings are fixed or intentionally downgraded
2. the remaining shared sealed-memory integrity items are fixed or explicitly
   downgraded
3. the repo no longer needs a vague “April 20 work may still have blurry
   boundaries” warning

At that point, archive this backlog and move any surviving items into a more
honest domain-specific queue instead of keeping a date-scoped review backlog
alive indefinitely.
