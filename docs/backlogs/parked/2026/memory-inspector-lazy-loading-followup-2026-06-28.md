# Memory Inspector Lazy Loading Follow-up

Created: 2026-06-28
Status: Parked

## Parking Decision

Keep the memory inspector's existing eager loader for now. The completed tree
remains understandable and functional, and there is no measured payload,
latency, or rendering problem that justifies adding lazy API boundaries,
per-node loading states, error recovery, and realtime synchronization.

This is a deliberate defer decision, not forgotten implementation work.

## Reopen When

Reopen this backlog only when measurements from representative long chats show
at least one of the following:

- summary or fact loading materially delays the initial chat or memory-panel
  experience
- serialized memory payload size becomes operationally significant
- large summary or fact row counts cause visible rendering or interaction lag
- eager loading creates a demonstrated query, bandwidth, or realtime-update
  cost

Do not reopen it solely because lazy loading seems architecturally cleaner.

## First Session After Reopening

Measure before choosing an implementation:

- summary and fact row counts for representative long chats
- loader query time and serialized payload size
- client render time when the memory panel opens
- whether summaries, facts, or both are responsible for the measured problem

Then choose the smallest useful boundary:

- eager meta summaries with lazy child chunks
- eager summary ranges/counts with lazy summary content
- eager summaries with lazy facts
- paginated summaries and facts only if simpler boundaries are insufficient

Any implementation must preserve edit, delete, regenerate, fallback, collapsed
tree, and realtime behavior.

## Context

The inspector implementation and the original loading-policy discussion are
recorded in
[`memory-structure-inspector-backlog-2026-05-08.md`](../../archive/2026/memory-structure-inspector-backlog-2026-05-08.md).
