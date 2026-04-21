# 2026-04-20 Feature Review Follow-up Backlog

Updated: 2026-04-21
Status: Completed

Completion note:

- concrete `2026-04-20` review findings that justified active work were closed
  in code, tests, and runner boundaries on `2026-04-21`
- the dead `sealEveryMessages` prefix-memory knob was removed from current
  config writes and tests while read-side normalization remains backward-
  compatible with older rows:
  `5aafdff` `Remove dead prefix memory seal knob`
- regeneration no longer deletes existing summaries before successful
  replacement, so summary-card regeneration failure no longer traps the user in
  a `no-card / no-regenerate-button` state:
  `b927d1e` `Preserve summaries when regeneration fails`
- the remaining `P2-2 / P2-3` ideas were downgraded instead of implemented
  after tracing the original premise more carefully:
  provider/LLM failures already create fallback summary rows, empty rows are not
  hidden by the current memory UI, and the most dangerous `no-card` path was
  the regeneration delete-first bug that is now fixed
- what remains is only a watch item:
  a future ordinary-generation `pre-insert` failure could still skip creating a
  new summary row, but that is no longer a date-scoped review queue and should
  be handled as a local bug if it is observed again

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
  `5aafdff` `Remove dead prefix memory seal knob`
- regeneration no longer deletes existing summaries before a successful
  replacement:
  `b927d1e` `Preserve summaries when regeneration fails`

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

## Closure Reason

This queue is closed because the remaining speculative `P2-2 / P2-3` work no
longer justifies an active date-scoped backlog.

What changed:

- the original `no-card` fear was narrowed
- provider/LLM summary failures already leave fallback summary rows
- empty summary rows are not hidden by the current memory UI
- the dangerous `delete-first` regeneration path is now fixed

That means the original escalation path:

- malformed summary
- no card rendered
- no regenerate button available
- new frontier helper / repair UX needed

is no longer the main reality of the system.

The only remaining concern is a narrower watch item:

- ordinary summary generation can still fail before row insertion in some
  pre-insert error paths

That is a local future bug candidate, not a reason to keep an `April 20`
review-hardening queue active.

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

Met on `2026-04-21`.

Any future follow-up from this area should start as a fresh local bug or a
domain-specific queue, not by reviving this date-scoped backlog.
