# Production Readiness Gate Backlog

Updated: 2026-04-14

This document turns `docs/reviews/production-readiness-gate-2026-04-14.html` into execution
batches.

It does not replace:

- `docs/backlogs/archive/2026/production-readiness-backlog-2026-04-14.md`, which closes the earlier
  `2026-04-12` review delta
- `docs/backlogs/archive/2026/FIRST_CLASS_HARDENING_BACKLOG.md`, which tracks broader operating-model work
  outside this gate

## Current Gate Snapshot

As of `2026-04-14`, the repo is in a stronger state than the earlier review cycle:

- `npm run test -- --coverage` passed during the gate
- `npm run build` passed during the gate
- the weighted gate score is `3.65 / 5.00` (`B`)

That still does not make the repo ready for broader public production. The original gate was
blocked by three concrete issues. `P0-1` and `P0-2` closed on `2026-04-14`; the remaining
highest-priority gaps are:

- API route parsing, auth, and error contracts are still inconsistent across the surface
- admin-client lifetime rules are still not enforced mechanically
- excluded and `0%` runtime boundaries still need direct verification

## Working Rules

- P0 closes deployment blockers or reproducibility gaps before broader cleanup
- every behavior or contract change lands with regression coverage in the same batch
- storage, auth, or environment-default changes update operator docs in the same change
- do not mix visual polish or speculative cleanup into this backlog

## P0

### P0-1. Remove Public-Read Asset Delivery

Status:

- Done on `2026-04-14`

Scope:

- `supabase/migrations/08_character_assets_storage.sql`
- `supabase/migrations/51_module_assets.sql`
- `src/lib/rbx-import-assets.ts`
- `src/app/api/chats/[chatId]/assets/route.ts`
- asset-access tests and operator docs

Why:

- the current storage policy keeps `character-assets` and `module-assets` publicly readable
- the repo's closed/private operating posture is not credible while asset URLs are served through
  `getPublicUrl()`

Done when:

- both buckets are private by default
- asset delivery uses signed URLs or an authenticated proxy
- no public-read policy remains for production buckets
- tests cover authorized and unauthorized asset access
- operator docs explain the expected delivery path

Current evidence as of `2026-04-14`:

- `supabase/migrations/08_character_assets_storage.sql` and
  `supabase/migrations/51_module_assets.sql` create public buckets and public-read policies
- `src/lib/rbx-import-assets.ts` and `src/app/api/chats/[chatId]/assets/route.ts` use
  `getPublicUrl()`

Completion evidence:

- `supabase/migrations/73_private_asset_delivery.sql` closes `character-assets` and
  `module-assets` and removes the public-read storage policies
- `src/app/api/chats/[chatId]/assets/route.ts`,
  `src/lib/assets/signed-asset-url.ts`, and `src/lib/assets/character-avatar.ts` now resolve
  authenticated signed URLs at runtime instead of public bucket URLs
- `src/lib/rbx-importer.ts` and `src/lib/rbx-import-assets.ts` stop persisting storage delivery
  URLs into character records during import
- regression coverage was added in `src/app/api/chats/[chatId]/assets/route.test.ts`,
  `src/lib/asset-resolver.test.ts`, and `src/lib/assets/character-avatar.test.ts`
- `npm run test`, `npm run typecheck`, and `npm run build` passed; `npm run ops:smoke` reached the
  deployed app and returned `WARN` only because `/api/internal/triage` reported one pre-existing
  failed job from `2026-04-11`

### P0-2. Make Direct Dependency Contracts Mechanical

Status:

- Done on `2026-04-14`

Scope:

- `package.json`
- `package-lock.json`
- CI verification for undeclared direct imports

Why:

- `zod` is imported directly across runtime code, but it is not declared as a top-level dependency
- a production build that passes only because of transitive lockfile luck is not reproducible

Done when:

- `zod` is declared directly in the root manifest
- CI fails if runtime code imports a package that is not declared in the manifest
- a clean install still passes `build`, `typecheck`, and core tests

Current evidence as of `2026-04-14`:

- `package.json` omits `zod`
- direct imports exist in `src/types/rbx.types.ts`, `src/lib/http/api-contract.ts`,
  `src/app/api/chat/route.ts`, `src/app/dashboard/api-keys/actions.ts`, and other runtime files
- the gate confirmed `npm ls zod --depth=0` is empty

Completion evidence:

- `package.json` and `package-lock.json` now declare both `zod` and `@ai-sdk/provider` at the root
  because both packages were directly imported from repo-owned source files
- `scripts/check-direct-dependencies.js` adds an AST-based guard that fails on undeclared bare
  imports across `src`, `tests`, and `scripts`
- `.github/workflows/test.yml` now runs `npm run check:dependencies` immediately after `npm ci`
- `npm ci`, `npm run check:dependencies`, `npm run typecheck`, `npm run test`, and `npm run build`
  all passed after the manifest update

## P1

### P1-1. Standardize Route Contracts and Auth Wrappers

Status:

- Done on `2026-04-14`

Scope:

- `src/lib/http/api-contract.ts`
- external and internal API routes still returning manual JSON or text responses
- shared auth helpers for internal and user-facing API routes

Why:

- only `5` of `33` `route.ts` files currently use the shared request/response contract
- inconsistent parse and error envelopes increase client branching and hide failures

Done when:

- JSON parse errors, schema errors, auth failures, and internal failures use one response envelope
  per route family
- route handlers stop manually casting `request.json()` payloads
- core mutation and internal routes have direct tests for malformed payloads and auth branches

Current evidence as of `2026-04-14`:

- `src/app/api/messages/translate/route.ts`,
  `src/app/api/internal/translate-message/route.ts`,
  `src/app/api/personas/[personaId]/route.ts`, `src/app/api/summaries/generate/route.ts`, and
  `src/app/api/chats/[chatId]/variables/route.ts` import `src/lib/http/api-contract.ts`
- `src/app/api/modules/route.ts`, `src/app/api/chats/[chatId]/system-prompt/route.ts`, and
  `src/app/api/announcements/route.ts` still keep manual response patterns

Completion evidence:

- `src/lib/http/api-contract.ts` now provides shared helpers for authenticated-user checks,
  bearer-token checks, invalid JSON/schema responses, and unexpected route failures
- `src/app/api/modules/route.ts`,
  `src/app/api/chats/[chatId]/system-prompt/route.ts`,
  `src/app/api/announcements/route.ts`,
  `src/app/api/internal/chat-admin/route.ts`,
  `src/app/api/characters/import/storage/route.ts`,
  `src/app/api/messages/translate/route.ts`,
  `src/app/api/chats/[chatId]/variables/route.ts`,
  `src/app/api/internal/translate-message/route.ts`, and
  `src/app/api/summaries/generate/route.ts` now share the same parse/auth/error helpers instead
  of hand-rolled `request.json()` casting and ad-hoc response branches
- `src/app/api/announcements/route.test.ts` was added, and existing route coverage in
  `src/app/api/characters/import/storage/route.test.ts`,
  `src/app/api/messages/translate/route.test.ts`,
  `src/app/api/internal/chat-admin/route.test.ts`,
  `src/app/api/internal/translate-message/route.test.ts`,
  `src/app/api/chats/[chatId]/variables/route.test.ts`, and
  `src/app/api/summaries/generate/route.test.ts` now exercises malformed payload and auth-failure
  branches against the shared envelope
- targeted route tests, the full `npm run test` suite, and `npm run build` all passed after the
  contract cleanup

### P1-2. Enforce Fresh Admin Client Usage

Status:

- Done on `2026-04-14`

Scope:

- `src/lib/supabase/admin.ts`
- `src/app/dashboard/admin/announcements/actions.ts`
- a lint or test guard that prevents module-scope admin-client caching

Why:

- the repo already documents a fresh-client rule
- keeping a module-scope admin client in runtime code creates an undocumented exception

Done when:

- admin clients are created per request or per action boundary
- no module-scope `createAdminClient()` results remain in runtime code
- a lint or unit check prevents regression

Current evidence as of `2026-04-14`:

- `src/lib/supabase/admin.ts` documents fresh creation as the intended pattern
- `src/app/dashboard/admin/announcements/actions.ts` still keeps
  `const adminSupabase = createAdminClient()` at module scope

Completion evidence:

- `src/app/dashboard/admin/announcements/actions.ts` now creates the service-role Supabase client
  inside each server action through a local helper instead of caching it at module scope
- `eslint.config.mjs` now rejects top-level `createAdminClient()` variable initialization in `src`
  so runtime code cannot quietly reintroduce module-scope admin-client caching
- `tests/announcements/admin-actions.test.ts` now asserts that auth failures do not create an admin
  client and that successful mutations create one fresh admin client per action call
- `tests/announcements/admin-actions-fresh-client.test.ts` adds an import-time regression check so
  loading the announcements action module no longer instantiates a service-role client eagerly
- `npm run lint`, `npm run typecheck`,
  `npm run test -- tests/announcements/admin-actions.test.ts tests/announcements/admin-actions-fresh-client.test.ts`,
  and `npm run build` all passed after the change

### P1-3. Add Direct Verification to Excluded and 0% Runtime Boundaries

Status:

- Done on `2026-04-14`

Scope:

- `vitest.config.ts`
- `src/lib/supabase/admin.ts`
- `src/lib/supabase/server.ts`
- `src/lib/chat/turns.ts`
- `src/app/api/internal/chat-job-runner/model-factory.ts`
- the highest-risk excluded chat UI shells and hooks

Why:

- the overall coverage number is healthy, but key runtime boundaries are still unverified or
  excluded
- the gate should not rely on denominator management alone

Done when:

- `0%` runtime files get direct tests or an explicit framework-seam justification
- excluded chat shells and hooks regain targeted tests for their stateful logic, even if they stay
  out of the global denominator
- coverage reporting stops masking these boundaries as invisible risk

Current evidence as of `2026-04-14`:

- `vitest.config.ts` excludes `src/app/dashboard/chats/[id]/hooks/**` and
  `src/app/dashboard/chats/[id]/components/**`
- the gate report still lists `src/lib/supabase/admin.ts`, `src/lib/supabase/server.ts`,
  `src/lib/chat/turns.ts`, and `src/app/api/internal/chat-job-runner/model-factory.ts` at `0%`

Completion evidence:

- `src/lib/supabase/admin.test.ts` and `src/lib/supabase/server.test.ts` now directly verify the
  service-role and SSR Supabase client factories, including missing-env failures and cookie/fetch
  boundary behavior
- `src/app/dashboard/chats/[id]/hooks/useQueuedChat.test.ts` adds direct stateful coverage for the
  previously unverified queued-chat hook, and `src/app/dashboard/chats/[id]/hooks/index.test.ts`
  verifies the hook barrel exports that feed the chat shell
- `package.json` now exposes `npm run test:runtime-boundaries`, and `.github/workflows/test.yml`
  runs that suite in CI before the global coverage pass so excluded chat hooks and re-export-only
  runtime boundaries stop being invisible risk
- `vitest.config.ts` keeps the chat-detail shells excluded from the global denominator, but now
  documents that those paths must stay backed by the dedicated runtime-boundary suite instead of
  being silently unverified
- `src/lib/chat/turns.test.ts` and
  `src/app/api/internal/chat-job-runner/model-factory.test.ts` remain part of the boundary suite;
  the wrapper files still appear as `0%` under V8 coverage because they are re-export-only seams,
  so the dedicated suite is the mechanical regression guard for those paths
- `npm run lint`, `npm run typecheck`, `npm run test:runtime-boundaries`, and
  `npm run test -- --coverage` all passed after the verification changes

## P2

### P2-1. Split Remaining Hot Paths by Operational Boundary

Status:

- Done on `2026-04-14`

Scope:

- `src/app/api/chats/[chatId]/assets/route.ts`
- `src/lib/chat-memory/index.ts`
- `src/app/dashboard/chats/[id]/summary-actions.ts`

Why:

- these files still combine policy, orchestration, and mutation details in one place
- the next round of changes will stay expensive until their boundaries are clearer

Done when:

- each file mainly owns orchestration, not deeply mixed policy and implementation
- storage access, memory transforms, and summary mutations can be changed in isolated modules
- direct tests cover the new seams

Current evidence as of `2026-04-14`:

- the gate action plan flagged these three files as the next structural split targets

Completion evidence:

- `src/app/api/chats/[chatId]/assets/route.ts` now stays focused on auth, ownership, signing, and
  response shaping while `src/app/api/chats/[chatId]/assets/asset-queries.ts` owns storage/module
  reads and `src/app/api/chats/[chatId]/assets/asset-payload.ts` owns payload transformation logic
- `src/lib/chat-memory/index.ts` now acts as a mode dispatcher while
  `src/lib/chat-memory/summary-window.ts` owns the summary-window path and
  `src/lib/chat-memory/prefix-live-blocks.ts` owns prefix-live-block planning and mutation work
- `src/app/dashboard/chats/[id]/summary-actions.ts` now stays at the action-orchestration layer,
  with `summary-action-support.ts` handling owned-chat context and path revalidation and
  `summary-regeneration.ts` isolating regeneration payload/model resolution and trigger calls
- direct seam coverage was added in
  `src/app/api/chats/[chatId]/assets/asset-payload.test.ts`,
  `src/app/dashboard/chats/[id]/summary-regeneration.test.ts`, and
  `src/lib/chat-memory/summary-window.test.ts`, while existing route/action/memory tests were
  updated to exercise the new split modules
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` all passed after the
  refactor; the build initially failed because `summary-action-support.ts` used a `'use server'`
  file with a sync export, and that boundary was corrected to `server-only`

### P2-2. Reconcile Docs and Defaults with a Closed-by-Default Operating Model

Status:

- Done on `2026-04-14`

Scope:

- `docs/OPERATING_PLAN.md`
- `docs/HOSTING_PROFILES.md`
- `SUPABASE_SETUP.md`
- `.env.example`
- storage or environment defaults touched by `P0` and `P1`

Why:

- the repo describes a more private operating posture than the live storage and default paths
  currently enforce
- future deployment decisions will keep drifting unless the contract is tightened once

Done when:

- docs and runtime defaults agree on what is public, what is authenticated, and what is
  experimental
- public-opening steps are explicit rather than accidental
- smoke or ops checks cover the closed-by-default assumptions

Current evidence as of `2026-04-14`:

- the gate found a mismatch between the stated closed/private posture and public asset delivery
- the action plan explicitly calls for more conservative security and operating defaults before any
  broader public opening

Completion evidence:

- `docs/OPERATING_PLAN.md`, `docs/HOSTING_PROFILES.md`, and `SUPABASE_SETUP.md` now state the live
  storage contract directly: `character-assets` and `module-assets` stay private by default and
  runtime delivery uses signed or authenticated URLs rather than anonymous public bucket reads
- `SUPABASE_SETUP.md` now documents storage-schema verification explicitly with
  `supabase db diff --linked --schema storage` whenever a migration touches buckets or storage
  policy, closing the old blind spot where `--schema public` alone could miss drift
- `.env.example` no longer turns optional profile overrides on by accident; developer-email,
  prompt-cache, and backfill examples are now commented so the copied default stays closer to the
  real closed-by-default operating posture
- `scripts/first-class-smoke-check.js` and `docs/FIRST_CLASS_SMOKE_CHECKS.md` now treat the
  closed-signup page as part of the passive operator contract, so `npm run ops:smoke` checks that
  `/auth/signup` still advertises the explicit closed-signup state instead of silently drifting
  toward open registration UX
- `scripts/first-class-smoke-check.test.js`, `npm run lint`, and `npm run format:check` all passed
  after the doc/default reconciliation changes

## Suggested Execution Order

1. `P0-1`
2. `P0-2`
3. `P1-1`
4. `P1-2` and `P1-3`
5. `P2-1` and `P2-2`
