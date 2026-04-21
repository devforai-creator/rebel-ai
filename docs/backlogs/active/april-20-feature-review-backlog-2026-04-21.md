# 2026-04-20 Feature Review Backlog

Updated: 2026-04-21
Status: Active

This document is the current execution backlog for one more focused review pass
over the large feature patches that landed on `2026-04-20` and the adjacent
boundaries they changed.

It starts after
[`review-followup-backlog-2026-04-21.md`](../archive/2026/review-followup-backlog-2026-04-21.md),
which closed the first concrete hardening findings found on `2026-04-21`.

This queue answers one narrow question:

- where should the next review pass spend time before ROI drops and work should
  return to normal feature delivery

It is not:

- a broad repo cleanup queue
- a new long-term-memory roadmap
- a pre-committed hardening backlog
- a reason to reopen already closed `2026-04-21` fixes without a new concrete
  finding

## Hard Rules

- Keep this queue review-shaped. Each item should correspond to a bounded code
  slice and a concrete risk hypothesis.
- Prefer confirming or killing a suspicion quickly over expanding scope.
- Small local fixes found during review can land immediately.
- Only create a separate hardening backlog when a validated issue is large
  enough that it should not be buried inside the review notes.
- If a suspected issue is acceptable, record that and move on instead of
  stretching the queue.
- Every behavior change from this queue lands with direct regression coverage in
  the same change.
- If a finding touches DB schema, migrations, RLS, or generated types, follow
  [DB_CHANGE_WORKFLOW.md](../../DB_CHANGE_WORKFLOW.md).

## Why This Queue Exists

The `2026-04-20` patch set was not one feature. It mixed several high-context
changes in the same day:

- chat core-path splits around request handling and runner follow-ups
- experimental ATR and transcript recall capability work
- shared sealed-memory hierarchy and episodic-RAG changes
- canonical memory backfill tooling
- surrounding debug and summary UI adjustments

One review pass already found real bugs quickly, which means there is still a
case for one more intentional pass. The goal is not indefinite review. The goal
is to give the remaining surface one structured pass, harvest any real issues,
and stop when the review stops paying for itself.

## Promotion Rules

Use these rules during review so this document stays small:

- Fix immediately when the issue is local, the correct behavior is already
  clear, and the regression test is straightforward.
- Create a separate hardening backlog item only when the finding spans multiple
  modules, needs staged work, or would otherwise distract from completing the
  review pass.
- Do not create hardening follow-ups for speculative cleanup, pure naming
  polish, or docs-only discomfort.

## Review Order

### R1. ATR / Transcript Recall

Status: `todo`

Why first:

- this is the largest net-new feature surface from `2026-04-20`
- it crosses config resolution, provider gating, tool policy, source mapping,
  and runner integration
- the first review pass already found ATR bugs quickly, so this remains the
  highest-yield slice

Primary scope:

- `src/lib/experimental/agentic-transcript-recall/**`
- `src/app/api/internal/chat-job-runner/provider-request-stage.ts`
- `src/app/api/internal/chat-job-runner/execution-context.ts`
- `src/lib/chat/model-config.ts`
- adjacent ATR tests under `src/app/api/internal/chat-job-runner/**` and
  `src/lib/experimental/agentic-transcript-recall/**`

Review invariants:

- ATR fails closed when runtime gating, provider support, or source mapping is
  missing
- surfaced navigation ranges and raw-fetchable ranges remain distinct
- tool-call budgets remain bounded across policy, runner, and debug accounting
- recalled transcript text stays in the in-flight request path only and does not
  become a normal persisted chat artifact
- fallback behavior does not silently widen the supported core chat contract

### R2. Chat Core Path Split

Status: `todo`

Why second:

- the route and runner splits are good structural changes, but they are
  contract-sensitive and easy to regress around admission, durable writes, and
  best-effort effects
- these files sit on the maintained request -> queue -> runner path, so hidden
  boundary drift here is expensive later

Primary scope:

- `src/app/api/chat/**`
- `src/app/api/internal/chat-job-runner/post-generation-pipeline.ts`
- `src/app/api/internal/chat-job-runner/assistant-finalization.ts`
- `src/app/api/internal/chat-job-runner/post-generation-metadata.ts`
- `src/app/api/internal/chat-job-runner/post-generation-followups.ts`
- targeted route and runner tests covering the split boundaries

Review invariants:

- request normalization and boundary rejection happen before persistence or
  enqueue
- admission, ownership, and regeneration-target rules stayed explicit after the
  extraction
- durable writes, rollback, and turn/message integrity remain ordered
  correctly
- best-effort follow-ups cannot fail the accepted core chat path
- `verify:core` still covers the seams that matter on this path

### R3. Memory / Canonical Hierarchy / Backfill

Status: `todo`

Why third:

- this slice mixes live memory behavior, regeneration, and offline repair
  tooling
- mistakes here tend to create stale-data or silent-drift problems that are
  harder to notice than request-path regressions

Primary scope:

- `src/lib/chat-memory/**`
- `src/lib/chat-summaries/**`
- `scripts/backfill-canonical-memory.js`
- adjacent tests for prefix memory, regeneration, episodic memory, and backfill

Review invariants:

- canonical sealed-memory ranges stay aligned across live prefix state,
  summaries, regeneration, and backfill
- `episodicRag` off disables fact generation everywhere it is supposed to,
  including regeneration and backfill paths
- partial failures do not preserve stale facts, stale summaries, or dead config
  writes
- backfill and load failures surface clearly instead of leaving silent drift
- older rows remain readable without reviving dead knobs in current writes

### R4. Surrounding UI / Debug / Summary Surfaces

Status: `todo`

Why last:

- these changes are real product surface, but they are downstream of the server
  and memory contracts above
- this slice is worth a pass, but it should not outrank the earlier boundary
  checks unless a new concrete bug points there

Primary scope:

- `src/app/dashboard/chats/[id]/components/**`
- `src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx`
- related chat dashboard tests

Review invariants:

- UI assumptions match the latest-only debug retention contract
- summary-panel rendering matches the canonical chunk and checkpoint model
- failure states still expose a visible regenerate or actionable recovery path
- presentation cleanup does not hide missing data or normalize broken server
  behavior

## Exit Conditions

This queue should stop instead of growing when one of these happens:

- all four slices are reviewed and any real issues have either been fixed or
  promoted to a small hardening queue
- two consecutive slices close with no material findings and no stronger new
  risk hypothesis
- a single validated cross-cutting problem appears that deserves its own
  narrower hardening backlog instead of continuing broad review

## Explicitly Parked

Do not pull these into this review queue unless a concrete bug points there:

- new ATR capability tuning by itself
- general long-term-memory redesign ideas
- pure docs cleanup from the `2026-04-20` patch set
- UI polish that does not change behavior or expose a contract mismatch
- broad cleanup of tests or file names without a review finding attached
