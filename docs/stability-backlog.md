# Stability Backlog

Updated: 2026-04-11

This document turns the recent repo-wide review into execution batches.

The goal is not to eliminate every issue before resuming work. The goal is to fix the highest-risk patterns, lock them with regression tests, and make future issues surface faster.

## Current Review Status

The repo has already been reviewed across these axes:

- development hygiene
- type and boundary quality
- complexity hotspots
- test gaps
- security quality

Do not continue broad whole-repo review by default from this point.

Use this backlog to drive the next work sessions.

## Working Rules

- Treat this as a batch backlog, not a finding dump.
- Group fixes by root cause and write scope, not by raw issue count.
- One work session should usually handle one batch.
- Every behavior fix must include a regression test in the same change.
- Do not schedule another whole-repo review until at least the P0 batches are done.
- After a batch lands, only re-review the changed area unless a new signal appears.

## Review Patterns

The current findings cluster into a few repeated patterns:

- destructive flows have weak consistency boundaries
- internal auth and secret handling have operational sharp edges
- legacy fallback paths reopen rules enforced elsewhere
- several core modules are too large and have low cohesion
- test gaps exist exactly where the riskiest boundaries live
- quality gates are strong overall, but some guardrails are still missing in CI

## P0

### P0-1. Destructive Action Consistency

Scope:

- [src/app/dashboard/api-keys/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/actions.ts)
- [src/app/dashboard/account/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/actions.ts)
- matching tests in [src/app/dashboard/api-keys/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/actions.test.ts) and [src/app/dashboard/account/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/actions.test.ts)

Why:

- current delete flows can leave half-deleted state across Vault, DB, and Auth
- this is the clearest data-loss / recovery-risk area found in review

Done when:

- `deleteApiKey` no longer leaves stale DB rows or orphaned Vault state on mixed failure paths
- `deleteAccount` no longer deletes secrets before the account deletion boundary is safely handled
- regression tests cover partial-failure behavior explicitly

Current status as of 2026-04-10:

- `deleteAccount` now treats `admin.deleteUser` as the deletion boundary, and only runs Vault secret cleanup after that succeeds
- `deleteAccount` now preloads and removes `character-assets`, `module-assets`, and `charx-uploads` storage paths after account deletion, with partial-failure regression coverage in [src/app/dashboard/account/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/actions.test.ts)

Current status as of 2026-04-11:

- `deleteApiKey` now runs through a single `delete_api_key` database function that clears the voyage RAG reference, deletes the `api_keys` row, and removes the Vault secret inside one transaction boundary
- regression coverage for `deleteApiKey` now lives in [src/app/dashboard/api-keys/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/actions.test.ts)

### P0-2. Internal Secret Handling at Request Time

Scope:

- [src/app/api/internal/import-job-timeout/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/import-job-timeout/route.ts)
- [src/app/api/characters/import/jobs/[id]/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/characters/import/jobs/[id]/route.ts)

Why:

- some routes cache `CHAT_ADMIN_SECRET` at module load
- warm server instances can keep using an old secret after rotation

Done when:

- internal secret reads happen at request time, not module init time
- tests cover missing secret and changed secret behavior where practical

Current status as of 2026-04-11:

- [src/app/api/internal/import-job-timeout/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/import-job-timeout/route.ts) now reads `CHAT_ADMIN_SECRET` at request time, with rotation coverage in [src/app/api/internal/import-job-timeout/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/import-job-timeout/route.test.ts)
- [src/app/api/characters/import/jobs/[id]/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/characters/import/jobs/[id]/route.ts) now reads `CHAT_ADMIN_SECRET` at timeout-dispatch time, with missing-secret and rotated-secret coverage in [src/app/api/characters/import/jobs/[id]/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/characters/import/jobs/[id]/route.test.ts)

### P0-3. Legacy Asset Safety Rollback

Scope:

- [src/app/api/chats/[chatId]/assets/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/assets/route.ts)
- [src/app/dashboard/chats/[id]/utils/message-renderer.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/message-renderer.tsx)
- [src/lib/suu-import-validation.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/suu-import-validation.ts)
- matching tests in [src/app/api/chats/[chatId]/assets/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/assets/route.test.ts)

Why:

- import validation blocks external and executable asset URLs
- legacy module fallback currently reintroduces `http` and `data:` asset paths into the render path

Done when:

- unsafe legacy asset fallbacks are removed or tightly constrained
- tests no longer lock in raw external/data URL passthrough
- the runtime safety rule matches the import-time safety rule

Current status as of 2026-04-11:

- [src/app/api/chats/[chatId]/assets/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/assets/route.ts) no longer injects raw legacy module asset URLs into `assetUrlMap`; only stored asset rows are exposed at runtime
- [src/app/dashboard/chats/[id]/utils/message-renderer.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/message-renderer.tsx) and its diagnostics now stop treating generic `assetUrlMap` entries as a plain emotion-tag resolver
- regression coverage in [src/app/api/chats/[chatId]/assets/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/assets/route.test.ts), [src/app/dashboard/chats/[id]/utils/message-renderer.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/message-renderer.test.tsx), and [src/lib/suu-import-validation.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/suu-import-validation.test.ts) now locks out raw external/data asset passthrough

## P1

### P1-1. Chat Turn Concurrency and Queue Entry Robustness

Scope:

- [src/lib/chat/turns.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turns.ts)
- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)

Why:

- `createChatTurn` computes `max(turn_index) + 1` in application code
- concurrent requests can fail as internal errors instead of handled conflicts

Done when:

- turn creation handles concurrent writes predictably
- tests cover concurrent or duplicate-admission edge cases

Current status as of 2026-04-11:

- [src/lib/chat/turns.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turns.ts) now retries transient `chat_turns(chat_id, turn_index)` races and promotes sustained collisions to a handled conflict instead of a generic 500
- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts) now maps sustained chat-turn admission conflicts to `409` with the existing active-response conflict message
- regression coverage for transient retries and sustained conflicts now lives in [src/lib/chat/turns.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turns.test.ts) and [src/app/api/chat/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.test.ts)

### P1-2. Background Trigger Assertions

Scope:

- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- [src/app/api/chat/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.test.ts)

Why:

- success-path tests currently do not prove that translation trigger and runner trigger were actually dispatched correctly

Done when:

- tests assert trigger invocation
- tests assert the expected internal URL and auth headers for the runner trigger

Current status as of 2026-04-11:

- [src/app/api/chat/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.test.ts) now asserts that successful user-message requests dispatch [triggerMessageTranslation](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-trigger.ts) with the persisted message ID and requester user ID
- the same test file now asserts `/api/internal/chat-job-runner/trigger` is called with the resolved internal origin, bearer auth header, and deployment-bypass header when configured

### P1-3. RBX Import Orphan Cleanup

Scope:

- [src/lib/rbx-importer.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/rbx-importer.ts)
- [src/lib/rbx-importer.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/rbx-importer.test.ts)
- cleanup scripts under [scripts](/home/tmdduq96kr/projects/rebel-ai/scripts)

Why:

- upload-success / DB-failure paths can leave orphaned storage objects
- `module-assets` cleanup is weaker than `character-assets`

Done when:

- upload + insert failure paths clean up both buckets correctly
- tests cover storage-success / DB-failure explicitly
- cleanup tooling or policy exists for both asset buckets

Current status as of 2026-04-10:

- character delete and RBX import rollback now clean up `character-assets` storage paths, with regression coverage in [src/app/dashboard/characters/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/actions.test.ts) and [src/lib/rbx-importer.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/rbx-importer.test.ts)
- one-off cleanup tooling now exists for both asset buckets at [scripts/cleanup-orphaned-character-assets.js](/home/tmdduq96kr/projects/rebel-ai/scripts/cleanup-orphaned-character-assets.js) and [scripts/cleanup-orphaned-module-assets.js](/home/tmdduq96kr/projects/rebel-ai/scripts/cleanup-orphaned-module-assets.js)
- both cleanup scripts now read DB references through `service_role` REST and walk Storage via recursive listing, so linked production sweeps no longer depend on `SUPABASE_DB_PASSWORD`
- linked production dry-run on 2026-04-10 found `1644` orphaned `character-assets` files and `1` orphaned `module-assets` file
- linked production execute sweep on 2026-04-10 deleted `500` `character-assets` orphans in a first safety batch, then deleted the remaining `1144`; it also deleted the lone `module-assets` orphan
- linked production verification on 2026-04-10 confirmed `0` `character-assets` orphans older than `1 day` and `0` `module-assets` orphans older than `1 day`
- a short-window janitor now exists at [src/app/api/internal/storage-janitor/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/storage-janitor/route.ts), backed by [src/lib/assets/orphaned-storage-janitor.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/assets/orphaned-storage-janitor.ts), with a fast `GET` trigger, a `POST` runner, and default policy `olderThanDays=1` and `maxDelete=500` per bucket
- RBX importer now removes uploaded objects from both buckets when storage upload succeeds but `character_assets` or `module_assets` insert fails, with explicit regression coverage in [src/lib/rbx-importer.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/rbx-importer.test.ts)
- RBX import rollback now removes already-persisted `module-assets` storage paths when a later module step fails
- direct module deletion now removes `module-assets` storage paths in [src/app/api/modules/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/modules/route.ts), with regression coverage in [src/app/api/modules/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/modules/route.test.ts)
- orphaned-module cleanup triggered from character update/delete now removes `module-assets` storage only for modules actually deleted, with regression coverage in [src/app/dashboard/characters/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/actions.test.ts)

Current status as of 2026-04-11:

- linked production dry-runs on 2026-04-11 found `0` `module-assets` orphans in both the recent-window scan and full scan, and `0` `character-assets` orphans older than `1 day`
- the same full `character-assets` dry-run found `1` recent orphan created at `2026-04-10T15:09:26Z`, so the leak is greatly reduced but not yet fully eliminated
- [src/lib/assets/storage-cleanup.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/assets/storage-cleanup.ts) no longer swallows storage remove failures silently; callers now get a `StorageCleanupError`
- irreversible delete flows now surface cleanup problems explicitly instead of reporting a clean success on silent storage remove failures, with coverage in [src/app/dashboard/characters/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/actions.test.ts), [src/app/dashboard/account/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/actions.test.ts), and [src/app/api/modules/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/modules/route.test.ts)
- RBX import cleanup now treats failed removal of an uploaded orphan candidate as a fatal import failure instead of silently downgrading it to a counted asset miss, with coverage in [src/lib/rbx-importer.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/rbx-importer.test.ts)

Next session start here:

- trace the remaining recent `character-assets` orphan against the exact delete path or import run that created it, then decide whether a follow-up fix belongs in character deletion, import rollback, or both
- wire the deployed scheduler to hit `/api/internal/storage-janitor` daily if it is not already configured, or add persistent janitor run telemetry if scheduler access stays outside the repo

### P1-4. CI Guardrail Tightening

Scope:

- [package.json](/home/tmdduq96kr/projects/rebel-ai/package.json)
- [.github/workflows/test.yml](/home/tmdduq96kr/projects/rebel-ai/.github/workflows/test.yml)
- [vitest.config.ts](/home/tmdduq96kr/projects/rebel-ai/vitest.config.ts)
- repo version-contract docs such as [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md)

Why:

- CI does not run explicit `typecheck`
- lint scope is narrower than the tested code surface
- Node version expectations are inconsistent
- coverage is reported without a floor

Done when:

- CI runs `npm run typecheck`
- lint covers `src`, `tests`, and `scripts` or an intentional equivalent
- Node version contract is explicit and consistent
- minimum coverage thresholds are defined

Current status as of 2026-04-11:

- [.github/workflows/test.yml](/home/tmdduq96kr/projects/rebel-ai/.github/workflows/test.yml) now runs `npm run typecheck` explicitly in the main CI job before tests
- [package.json](/home/tmdduq96kr/projects/rebel-ai/package.json) now lint-covers `src`, `tests`, and `scripts`, and declares a Node `20.x` engine contract
- [eslint.config.mjs](/home/tmdduq96kr/projects/rebel-ai/eslint.config.mjs) now treats repository `scripts` as intentional CommonJS entrypoints instead of failing on `require()`
- [vitest.config.ts](/home/tmdduq96kr/projects/rebel-ai/vitest.config.ts) now defines minimum global coverage thresholds for statements, branches, functions, and lines
- [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md) now aligns local setup guidance with the Node 20 CI/runtime contract

## P2

### P2-1. Split `turns.ts` by Responsibility

Scope:

- [src/lib/chat/turns.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turns.ts)

Suggested seams:

- `turn-graph.ts`
- `turn-write.ts`
- `turn-projection.ts`
- `turn-projection-query.ts`

Why:

- import graph generation, write path, generation transcript loading, and read projections currently live in one low-cohesion module

Done when:

- write, projection, and import concerns are separated
- tests align with the split boundaries

Current status as of 2026-04-11:

- [src/lib/chat/turns.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turns.ts) is now a thin public facade that re-exports the existing chat-turn API instead of keeping all responsibilities in one file
- write-path logic now lives in [src/lib/chat/turn-write.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-write.ts), turn graph construction in [src/lib/chat/turn-graph.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-graph.ts), and projection/query logic in [src/lib/chat/turn-projection.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-projection.ts) plus [src/lib/chat/turn-projection-query.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-projection-query.ts)
- shared turn-facing types now live in [src/lib/chat/turn-types.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-types.ts) so callers can keep the same `@/lib/chat/turns` entrypoint without introducing cross-module cycles
- existing regression coverage in [src/lib/chat/turns.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turns.test.ts), [src/app/api/chat/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.test.ts), [src/app/api/internal/chat-job-runner/service.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/service.test.ts), and [src/lib/chat-summaries/db-helpers.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/db-helpers.test.ts) still passes against the split modules

### P2-2. Decompose Core Orchestrators

Scope:

- [src/app/api/internal/chat-job-runner/service.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/service.ts)
- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- [src/lib/rbx-importer.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/rbx-importer.ts)

Why:

- these files carry too much branching, policy, and side-effect orchestration in one place

Done when:

- policy, persistence, queue, and provider logic have narrower module boundaries
- change impact is smaller and easier to test per boundary

### P2-3. Remove Repeated Action Flows

Scope:

- [src/app/dashboard/account/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/actions.ts)

Why:

- several server actions repeat the same auth, parse, validation, update, and revalidation structure

Done when:

- repeated action skeletons are extracted into shared helpers or smaller focused functions

### P2-4. Secondary Test Gaps

Scope:

- [src/app/auth/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/auth/actions.ts)
- [src/app/auth/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/auth/actions.test.ts)

Why:

- login is covered more than logout / blocked signup behavior

Done when:

- auth action coverage reflects the full current surface

Current status as of 2026-04-11:

- [src/app/auth/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/auth/actions.test.ts) now covers the currently shipped auth surface instead of focusing mostly on login
- login validation coverage now includes the missing-password branch alongside missing-email and provider-error cases
- blocked signup behavior is now locked with an explicit regression test so future changes do not silently reopen registration
- logout coverage now asserts both the normal sign-out redirect path and the current “log error but still redirect” behavior when `supabase.auth.signOut()` fails

## Recommended Execution Order

1. P0-1 Destructive Action Consistency
2. P0-2 Internal Secret Handling at Request Time
3. P0-3 Legacy Asset Safety Rollback
4. P1-2 Background Trigger Assertions
5. P1-1 Chat Turn Concurrency and Queue Entry Robustness
6. P1-3 RBX Import Orphan Cleanup
7. P1-4 CI Guardrail Tightening
8. P2 refactors after the P0 and P1 boundaries are locked with tests

## Session Policy

For the next few sessions:

- do not start another broad review pass first
- pick one batch
- implement it end to end
- add regression tests
- run the relevant verification commands
- then update this document

This backlog should shrink by completed batches, not grow by new whole-repo exploration.
