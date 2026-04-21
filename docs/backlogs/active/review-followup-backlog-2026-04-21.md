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

The remaining review surface is concentrated in two areas:

- memory and backfill contract drift
- chat core path split boundaries that were mechanically improved but not yet
  deeply re-audited after the same feature burst

So the next work should prioritize:

1. contract drift that can mutate or rebuild persisted memory incorrectly
2. stale-data cases that can resurrect invalid facts later
3. dead or duplicate read paths on hot request surfaces
4. deep-audit review of the route and post-generation split only after the
   memory/backfill issues are either fixed or explicitly downgraded

## Priority Order

### P0-1. Fix Canonical Backfill To Respect Episodic-RAG-Off Chats

Why first:

- this is a real contract bug, not just code smell
- the operator backfill path can currently mark healthy chats as broken and
  purge/rebuild them unnecessarily

Primary scope:

- [scripts/backfill-canonical-memory.js](/home/tmdduq96kr/projects/rebel-ai/scripts/backfill-canonical-memory.js)
- [scripts/backfill-canonical-memory.test.js](/home/tmdduq96kr/projects/rebel-ai/scripts/backfill-canonical-memory.test.js)
- [src/lib/chat-summaries/episodic-memory.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/episodic-memory.ts)

Done when:

- backfill analysis understands that `chat_facts` are optional when episodic RAG
  is disabled for the chat owner
- canonical chunk/meta validation still works as before
- dry-run output no longer flags `missing_fact_ranges` for healthy
  episodic-RAG-off chats
- tests cover both episodic-RAG-on and episodic-RAG-off cases

### P0-2. Prevent Stale Facts During Regeneration When Episodic RAG Is Disabled

Why next:

- this is a persisted stale-data risk
- disabling fact generation should not leave old fact rows silently attached to
  regenerated chunk ranges

Primary scope:

- [src/lib/chat-summaries/regeneration.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/regeneration.ts)
- [src/lib/chat-summaries/regeneration.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/regeneration.test.ts)
- [src/lib/chat-summaries/sealed-memory-writer.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/sealed-memory-writer.ts)

Done when:

- chunk regeneration removes existing facts for the same range even when new
  fact generation is disabled
- fact-only regeneration still remains a no-op when episodic RAG is disabled
- tests prove that disabling episodic RAG cannot preserve stale `chat_facts`
  rows for regenerated ranges

### P1-1. Remove The Dead Full-Facts Query From Context Building

Why after the two correctness bugs:

- this is not a data-corruption issue, but it is a request-path boundary leak
- the query currently pays read cost without affecting the built context

Primary scope:

- [src/lib/chat-summaries/context-builder.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/context-builder.ts)
- [src/lib/chat-summaries/types.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/types.ts)
- any related diagnostics tests

Done when:

- `buildContext()` stops loading full fallback fact rows that it does not use
- diagnostics remain honest about what was actually queried
- tests lock the intended RAG path without the dead read-side work

### P1-2. Deep Audit The Split Chat Request Path

Why now:

- the route split on `2026-04-20` was probably directionally right
- it still deserves one focused review pass after the same-day feature burst

Primary scope:

- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- [src/app/api/chat/request-contract.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/request-contract.ts)
- [src/app/api/chat/chat-admission.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/chat-admission.ts)
- [src/app/api/chat/submit-chat-job.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/submit-chat-job.ts)
- [src/app/api/chat/job-persistence.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/job-persistence.ts)

Done when:

- one review pass confirms whether request parsing, admission, persistence, and
  enqueue rollback semantics still match the supported contract
- any concrete findings are either fixed or explicitly parked with rationale
- the queue no longer needs an “unreviewed route split” warning

### P1-3. Deep Audit The Post-Generation Split And Best-Effort Follow-ups

Why last:

- this is lower urgency than the memory correctness items
- it is still part of the same `2026-04-20` burst and touches durable-vs-best-
  effort boundaries

Primary scope:

- [src/app/api/internal/chat-job-runner/post-generation-pipeline.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/post-generation-pipeline.ts)
- [src/app/api/internal/chat-job-runner/assistant-finalization.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/assistant-finalization.ts)
- [src/app/api/internal/chat-job-runner/post-generation-followups.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/post-generation-followups.ts)
- [src/app/api/internal/chat-job-runner/post-generation-metadata.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/post-generation-metadata.ts)

Done when:

- one review pass confirms that best-effort translation and summary follow-ups
  cannot blur durable success semantics
- any concrete findings are either fixed or explicitly parked with rationale
- the queue no longer needs an “unreviewed post-generation split” warning

## Explicitly Parked

Do not pull these into this backlog unless a concrete bug points there:

- ATR capability tuning beyond the fixes already landed on `2026-04-21`
- pure docs cleanup from `2026-04-20`
- `ChatSummariesPanel` collapse-default UI polish by itself
- debug-modal presentation cleanup by itself
- a broad long-term-memory redesign

## End Condition

This queue is done when:

1. the known memory/backfill findings are fixed or intentionally downgraded
2. the `2026-04-20` chat route split and post-generation split each receive one
   explicit review pass
3. the repo no longer needs a vague “April 20 work may still have blurry
   boundaries” warning

At that point, archive this backlog and move any surviving items into a more
honest domain-specific queue instead of keeping a date-scoped review backlog
alive indefinitely.
