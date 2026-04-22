# Non-Chat-Core Seam Review Backlog

Updated: 2026-04-22
Status: Active

This document is the current execution backlog for one repo-wide hardening
review pass focused on seams outside the maintained chat core path.

For the maintained core path itself, use
[FIRST_CLASS_PATH_MAP.md](../../FIRST_CLASS_PATH_MAP.md) and the already closed
review/backlog work around `request -> queue -> runner -> finalize`.

This queue answers one narrower question:

- where should the next hardening review time go if the goal is seam strength
  across the rest of the product rather than another pass through chat core

It is not:

- a broad repo cleanup wishlist
- a commitment to rewrite auth, storage, or dashboard architecture up front
- a reason to reopen closed chat-core review slices without a new seam finding
- a substitute for fixing a concrete production bug immediately if one appears

## Working Rules

- Keep this queue review-shaped. Each item should correspond to a bounded seam
  and a concrete risk hypothesis.
- Prefer confirming or killing a suspicion quickly over expanding scope.
- If a boundary looks acceptable after review, record that and move on.
- Only promote a finding into a separate hardening backlog when the work spans
  multiple modules or multiple sessions.
- Every behavior change that lands from this queue ships with direct regression
  coverage in the same change.
- If a finding touches DB schema, migrations, RLS, or generated types, follow
  [DB_CHANGE_WORKFLOW.md](../../DB_CHANGE_WORKFLOW.md).
- Favor ownership, auth, rollback, and cleanup boundaries over naming or style
  cleanup.

## Why This Queue Exists

The first-class chat path has already received several recent hardening passes.
The higher-ROI next review is not "read all of chat core again." It is the set
of adjacent seams that still cross auth, storage, admin triggers, browser
exceptions, signed URLs, Vault, and dashboard mutations.

These areas are valuable precisely because they sit near trust boundaries:

- several internal routes still hand-roll bearer-secret checks even though a
  shared helper exists
- browser-authenticated Supabase runtime usage is now explicitly allowlisted,
  but the remaining exception set still deserves one deliberate review pass
- import, storage, asset signing, janitor, and dashboard mutation flows all mix
  ownership checks with non-trivial cleanup or follow-up behavior

The goal is not to create another giant architecture project. The goal is to
review the non-core seams in a deliberate order, harvest any real issues, and
stop when the review stops paying for itself.

## Promotion Rules

- Fix immediately when the issue is local, the correct behavior is already
  clear, and the regression test is straightforward.
- Create a narrower hardening backlog only when a validated finding spans
  multiple files or needs staged rollout work.
- Do not create follow-ups for speculative refactors, naming polish, or docs
  discomfort by itself.

## Review Order

### S1. Internal Admin And Trigger Auth Seams

Status: `completed`

Progress note:

- started on `2026-04-22`
- first auth sub-slice landed: shared bearer-token helpers now cover the
  internal admin-or-cron trigger routes plus the remaining single-secret
  internal routes reviewed in this pass
- `job-janitor` no longer requires both `CHAT_ADMIN_SECRET` and `CRON_SECRET`
  just to accept one valid configured bearer secret
- misconfiguration responses on the reviewed internal bearer routes were
  normalized back to the shared `Server misconfigured` contract
- the remaining reviewed routes closed without a broader auth redesign need
- one additional user-facing seam bug landed during the closing pass:
  stale import-job polling no longer risks hanging on an unbounded internal
  timeout-mark request

Why first:

- this is the sharpest trust boundary outside chat core
- multiple internal routes still implement bearer-secret checks manually even
  though `requireBearerToken` already exists
- admin-secret and cron-secret behavior is security-sensitive and cheap to
  review compared with deeper refactors

Primary scope:

- [src/lib/http/api-contract.ts](../../../src/lib/http/api-contract.ts)
- [src/app/api/internal/chat-admin/route.ts](../../../src/app/api/internal/chat-admin/route.ts)
- [src/app/api/internal/chat-job-runner/trigger/route.ts](../../../src/app/api/internal/chat-job-runner/trigger/route.ts)
- [src/app/api/internal/character-import-runner/route.ts](../../../src/app/api/internal/character-import-runner/route.ts)
- [src/app/api/internal/character-import-runner/trigger/route.ts](../../../src/app/api/internal/character-import-runner/trigger/route.ts)
- [src/app/api/internal/charx-import-runner/route.ts](../../../src/app/api/internal/charx-import-runner/route.ts)
- [src/app/api/internal/charx-import-runner/trigger/route.ts](../../../src/app/api/internal/charx-import-runner/trigger/route.ts)
- [src/app/api/internal/import-job-timeout/route.ts](../../../src/app/api/internal/import-job-timeout/route.ts)
- [src/app/api/internal/job-janitor/route.ts](../../../src/app/api/internal/job-janitor/route.ts)
- [src/app/api/internal/storage-janitor/route.ts](../../../src/app/api/internal/storage-janitor/route.ts)
- [src/app/api/internal/translate-message/route.ts](../../../src/app/api/internal/translate-message/route.ts)
- [src/app/api/internal/triage/route.ts](../../../src/app/api/internal/triage/route.ts)
- adjacent internal-route tests

Review invariants:

- secret lookup happens at request time so rotation takes effect without stale
  module state
- bearer-only auth stays explicit and query-param secret creep does not return
- admin-secret and cron-secret acceptance rules are obvious and consistent per
  route
- alias routes do not accidentally widen the accepted auth surface
- unauthorized and misconfigured responses stay deliberate and do not leak
  sensitive detail

### S2. Browser Supabase And Realtime Exception Seams

Status: `completed`

Progress note:

- completed on `2026-04-22`
- the two explicitly allowlisted browser Supabase hooks now fail closed when
  browser session bootstrap rejects, instead of leaking an unhandled rejection
  before channel setup
- hook-level regression coverage now pins the bootstrap-failure path for both
  allowed runtime importers
- the browser Supabase import allowlist remains explicit and mechanically
  guarded by `check-browser-supabase-client`
- the rest of the reviewed seam did not justify a broader "remove browser auth"
  refactor or allowlist expansion

Why second:

- the browser Supabase runtime surface is now intentionally small enough to
  reason about
- the remaining exception set is explicit in
  `scripts/check-browser-supabase-client.js`, which makes this a bounded review
  instead of a broad auth rewrite
- if this seam is acceptable as-is, that is useful to confirm explicitly;
  otherwise the next hardening step should be chosen deliberately

Primary scope:

- [scripts/check-browser-supabase-client.js](../../../scripts/check-browser-supabase-client.js)
- [src/lib/supabase/client.ts](../../../src/lib/supabase/client.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts](../../../src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](../../../src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)
- any directly adjacent realtime or auth-session tests

Review invariants:

- the allowlisted runtime exception set remains explicit and mechanically
  guarded
- browser `getSession()` usage does not quietly spread into new runtime flows
- route refresh and server snapshots remain authoritative over optimistic local
  cache
- realtime payload parsing fails closed instead of normalizing malformed data
- any next-step recommendation is explicit about latency, complexity, and
  security tradeoffs rather than vague "remove browser auth" pressure

### S3. Import Upload Contract And Import Runner Seams

Status: `in_progress`

Progress note:

- started on `2026-04-22`
- first seam fix landed: import upload admission and runner-side storage-path
  validation now require the staged `${userId}/imports/` prefix instead of
  accepting any object under `${userId}/`
- shared path helpers and regression coverage now pin the staged-upload scope
  so import jobs cannot read or delete arbitrary user-scoped storage objects
  just because they share the same user prefix
- expired signed upload tickets now clean up their own staged import object
  before returning `403`, which closes one stale-client orphan path without
  widening cleanup to malformed or untrusted ticket payloads
- runner route responses now mirror the actual import execution result instead
  of reporting `success` after helper-managed job failures that already wrote
  `error` into `charx_import_jobs`

Why third:

- this seam crosses upload admission, signed upload contracts, staged storage,
  queue admission, service-role/admin trust, background runners, and timeout
  repair
- it is outside chat core but still handles non-trivial durable state and
  cleanup
- a review here can catch trust-boundary drift without requiring a broad import
  rewrite

Primary scope:

- [src/app/api/characters/import/storage/route.ts](../../../src/app/api/characters/import/storage/route.ts)
- [src/lib/import/upload-ticket.ts](../../../src/lib/import/upload-ticket.ts)
- [src/lib/import/upload-path.ts](../../../src/lib/import/upload-path.ts)
- [src/lib/character-import-jobs.ts](../../../src/lib/character-import-jobs.ts)
- [src/app/api/internal/character-import-runner/route.ts](../../../src/app/api/internal/character-import-runner/route.ts)
- [src/app/api/internal/character-import-runner/trigger/route.ts](../../../src/app/api/internal/character-import-runner/trigger/route.ts)
- [src/app/api/internal/charx-import-runner/route.ts](../../../src/app/api/internal/charx-import-runner/route.ts)
- [src/app/api/internal/charx-import-runner/trigger/route.ts](../../../src/app/api/internal/charx-import-runner/trigger/route.ts)
- [src/app/api/internal/import-job-timeout/route.ts](../../../src/app/api/internal/import-job-timeout/route.ts)
- import-route and import-runner tests

Review invariants:

- prepare, enqueue, runner, and timeout paths agree on ownership and job-state
  assumptions
- upload tickets cannot be replayed across users or mutated into a different
  file/path contract
- fallback secret usage does not silently widen the trusted boundary beyond the
  intended operator model
- cleanup and timeout behavior cannot overwrite completed work or leave staged
  uploads behind without visible signal
- queue conflict handling and staged-upload cleanup stay aligned

### S4. Private Asset Delivery And Storage Cleanup Seams

Status: `pending`

Why fourth:

- this seam mixes admin reads, signed URL generation, legacy asset-token
  normalization, private asset delivery, and destructive janitor behavior
- asset handling is not the core chat pipeline, but it directly touches trust,
  privacy, and user-visible correctness
- the relevant surface is relatively compact and reviewable

Primary scope:

- [src/app/api/chats/[chatId]/assets/route.ts](../../../src/app/api/chats/[chatId]/assets/route.ts)
- [src/app/api/chats/[chatId]/assets/asset-queries.ts](../../../src/app/api/chats/[chatId]/assets/asset-queries.ts)
- [src/lib/asset-token.ts](../../../src/lib/asset-token.ts)
- [src/lib/asset-resolver.ts](../../../src/lib/asset-resolver.ts)
- [src/lib/assets/signed-asset-url.ts](../../../src/lib/assets/signed-asset-url.ts)
- [src/lib/assets/orphaned-storage-janitor.ts](../../../src/lib/assets/orphaned-storage-janitor.ts)
- [src/lib/assets/storage-cleanup.ts](../../../src/lib/assets/storage-cleanup.ts)
- asset and janitor tests

Review invariants:

- user ownership is verified before any admin-only asset read or signing step
- legacy asset-token normalization does not reopen raw-HTML or arbitrary-URL
  assumptions the repo has already retired
- signed URL failures degrade safely and observably instead of silently
  widening access
- janitor criteria stay bounded enough that live referenced objects are not
  deleted by convenience
- compatibility helpers remain clearly compatibility helpers, not a second
  canonical asset contract

### S5. Dashboard Mutation And Ownership Seams

Status: `pending`

Why last:

- these paths are important, but they are easier to review once auth, import,
  and asset boundaries above are classified
- the main risk here is not giant architecture; it is partial writes, cleanup
  ordering, ownership checks, and hidden rollback behavior across server actions
  and RPC/Vault boundaries

Primary scope:

- [src/app/dashboard/characters/actions.ts](../../../src/app/dashboard/characters/actions.ts)
- [src/lib/modules/ownership.ts](../../../src/lib/modules/ownership.ts)
- [src/lib/modules/orphan-cleanup.ts](../../../src/lib/modules/orphan-cleanup.ts)
- [src/app/dashboard/personas/actions.ts](../../../src/app/dashboard/personas/actions.ts)
- [src/lib/personas/update.ts](../../../src/lib/personas/update.ts)
- [src/app/dashboard/api-keys/actions.ts](../../../src/app/dashboard/api-keys/actions.ts)
- [src/lib/supabase/rpc.ts](../../../src/lib/supabase/rpc.ts)
- adjacent dashboard action tests

Review invariants:

- ownership is verified before write-side effects, not reconstructed afterward
- multi-step writes are atomic where required or return explicit rollback and
  cleanup outcomes where atomicity is not possible
- storage cleanup, orphan cleanup, and Vault cleanup only run after the durable
  boundary they depend on
- revalidation and redirect behavior does not hide partial-failure semantics
- shared helpers own repeated mutation rules instead of each action drifting on
  its own contract

## Exit Conditions

This queue should stop instead of growing when one of these happens:

- all five slices are reviewed and any real issues have either been fixed or
  promoted to a narrower hardening queue
- two consecutive slices close with no material findings and no stronger new
  risk hypothesis
- a single validated cross-cutting problem appears that deserves its own
  dedicated backlog instead of continuing broad seam review

## Explicitly Parked

Do not pull these into this queue unless a seam review points there directly:

- the maintained chat request, queue, runner, and finalization path
- ATR, transcript-recall, memory hierarchy, or summary-quality feature work
- dashboard chat-shell cleanup by itself
- general UI polish
- doc wording cleanup without a concrete contract mismatch
