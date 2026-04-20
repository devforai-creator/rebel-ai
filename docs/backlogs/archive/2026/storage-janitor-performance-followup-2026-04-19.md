# Storage Janitor Performance Follow-Up

Updated: 2026-04-19

This backlog records the current storage janitor performance review and the
decision to defer implementation work for now.

The goal is not to start another broad DB/storage optimization pass. The goal
is to preserve the measured findings, define the trigger for reopening this
work, and avoid re-running the same investigation from scratch later.

## Current Snapshot

Observed on 2026-04-19 from the linked remote database and linked dry-run
scripts:

- `storage.objects` row counts:
  - `character-assets`: `63,178`
  - `module-assets`: `9,832`
- DB reference table row counts:
  - `character_assets`: `63,178`
  - `module_assets`: `9,832`
- orphan counts at review time:
  - `character-assets`: `0`
  - `module-assets`: `0`
- linked dry-run wall time:
  - `character-assets`: about `100.6s`
  - `module-assets`: about `17.9s`
- janitor route runtime budget:
  - [src/app/api/internal/storage-janitor/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/storage-janitor/route.ts:10) uses `maxDuration = 300`

Important query observations:

- DB-side orphan anti-join itself is not the expensive part.
- representative linked `EXPLAIN ANALYZE` results:
  - `character-assets` orphan count anti-join: about `86.9ms`
  - `module-assets` orphan count anti-join: about `11.5ms`
- the current cost comes from storage bucket traversal, not from SQL join cost

Current implementation shape:

- [src/lib/assets/orphaned-storage-janitor.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/assets/orphaned-storage-janitor.ts:141) loads all referenced `storage_path` values into memory
- [src/lib/assets/orphaned-storage-janitor.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/assets/orphaned-storage-janitor.ts:183) recursively walks the storage bucket with `storage.list()`
- [src/app/api/internal/storage-janitor/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/storage-janitor/route.ts:193) runs both janitors in parallel

## Decision

Do not implement a janitor rewrite yet.

Reasoning:

- the current path is structurally linear in bucket size, so it is a real future
  optimization candidate
- but the current linked runtime still fits safely within the existing `300s`
  execution budget
- there are currently no orphaned objects, so the janitor is spending time
  confirming cleanliness rather than failing to keep up with real residue
- the next implementation step would increase coupling to `storage.objects`
  query semantics, which is acceptable only once the operational pressure is
  clearer

Conclusion:

- this is a valid backlog item
- it is not a high-ROI implementation target today
- further general DB work after the current audit batch would likely have lower
  ROI than other product or operational work

## Reopen Triggers

Reopen this work when one or more of the following becomes true:

- `character-assets` approaches or exceeds roughly `150k` to `200k` objects
- a normal dry-run janitor pass approaches `180s+`
- janitor runs begin timing out or colliding with operational windows
- orphan counts start accumulating instead of staying near zero
- janitor cadence needs to increase materially

## Recommended Future Direction

If this backlog is reopened, prefer changing query shape before adding more
operational retries or concurrency.

Suggested direction:

1. derive orphan candidate paths from DB using `storage.objects` plus an anti-join
   against `character_assets` or `module_assets`
2. page that candidate list directly
3. delete only the returned paths through Storage
4. keep dry-run and execute modes behaviorally identical apart from deletion

Guardrails:

- keep the current auth and internal-route boundary intact
- preserve sample reporting and delete limits
- verify post-change behavior with linked dry-run timing, not code shape alone

## Session Close Note

As of 2026-04-19, the current DB-focused audit can be considered complete for
practical purposes:

- RLS and security boundaries were hardened
- turn/message integrity invariants were enforced
- hot chat DB indexes were reviewed and added where justified
- usage/job invariants were enforced
- SQL-change CI checks were tightened
- linked real-data performance checks do not show an urgent chat DB bottleneck
- storage janitor performance is the only remaining clear optimization candidate,
  and it is currently better kept as deferred backlog work
