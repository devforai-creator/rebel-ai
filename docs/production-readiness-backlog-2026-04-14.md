# Production Readiness Backlog

Updated: 2026-04-14

This document re-baselines the `2026-04-12` production-readiness gate against the current repo
state.

It intentionally keeps only the remaining review-driven work. Completed batches from
[production-readiness-followups-2026-04-12.md](./production-readiness-followups-2026-04-12.md) and
[production-audit-backlog-2026-04-12.md](./production-audit-backlog-2026-04-12.md) are not copied
forward.

It also does not replace:

- [review-followups.md](./review-followups.md) for visual direction and UI polish
- [FIRST_CLASS_HARDENING_BACKLOG.md](./FIRST_CLASS_HARDENING_BACKLOG.md) for operating-model work
  outside the original review delta

## Current Baseline

As of `2026-04-14`, the repo is in a better state than the `2026-04-12` review snapshot:

- `npm run lint` passes
- `npm run typecheck` passes
- `npm run test -- --coverage` passes at `85.56%` statements, `77.04%` branches, `90.09%`
  functions, and `85.95%` lines
- the chat runner is already stage-split and the orchestration shell is down to `248` lines in
  `src/app/api/internal/chat-job-runner/service.ts`
- the largest chat UI surfaces have already shrunk materially:
  - `src/app/dashboard/chats/[id]/ChatInterface.tsx`: `564` lines
  - `src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx`: `370` lines
  - `src/app/dashboard/chats/[id]/LorebookPanel.tsx`: `270` lines
  - `src/app/dashboard/chats/[id]/components/MessageList.tsx`: `164` lines
  - `src/app/dashboard/chats/[id]/components/MessageBubble.tsx`: `143` lines
- import/runtime limits are already partly centralized under `src/lib/import/constants.ts`

That changes the priority order from the original review:

- gate restoration is no longer the main problem
- broad UI decomposition is no longer the first blocker
- the highest remaining friction is now route-contract inconsistency, untested mutation surfaces,
  and weakly typed Supabase/RPC seams

## Remaining Review Themes

- secondary and internal routes still do not follow one shared request/response contract
- malformed JSON and schema mismatch handling still varies by route
- several mutation-heavy chat server actions still sit at `0%` coverage
- runtime Supabase and RPC boundaries still rely on `as unknown as` in production code
- chat and runner limits are narrower than before but still spread across several files
- the main chat shell is improved enough to be a later batch, not an immediate blocker

## Working Rules

- Keep this backlog narrow: only remaining production-readiness delta from the `2026-04-12` review
- Every behavior change lands with regression coverage in the same batch
- Prefer shared helpers over repeated route-by-route cleanup
- Do not mix visual redesign work into these batches
- Do not reopen already-closed work unless a current failing signal justifies it

## P0

### P0-1. Standardize Secondary and Internal Route Contracts

Scope:

- `src/app/api/messages/translate/route.ts`
- `src/app/api/internal/translate-message/route.ts`
- `src/app/api/summaries/generate/route.ts`
- `src/app/api/chats/[chatId]/variables/route.ts`
- `src/app/api/personas/[personaId]/route.ts`

Why:

- the main chat route already uses a recognizable contract: `zod` parsing plus a local
  `createErrorResponse` helper
- the remaining secondary routes still mix plain-text responses, `{ error }` JSON, manual payload
  branching, and leaked internal details
- this is now the clearest remaining `2026-04-12` review item that still affects both UI handling
  and operator diagnostics

Done when:

- malformed JSON returns `400`, not a generic `500`
- schema mismatch follows one shared parse path instead of route-local casts
- error responses use one JSON envelope for user-facing failures on these routes
- `src/app/api/summaries/generate/route.ts` no longer returns raw `details` from thrown exceptions
- route tests lock malformed JSON, auth, ownership, and internal-failure behavior directly

Current evidence as of `2026-04-14`:

- `src/app/api/messages/translate/route.ts` still uses raw `await request.json()` and plain-text
  `new Response(...)`
- `src/app/api/internal/translate-message/route.ts` still casts request JSON directly to
  `{ messageId, userId }`
- `src/app/api/summaries/generate/route.ts` still casts
  `(await request.json()) as GenerateSummariesRequest` and returns `{ error, details }`
- `src/app/api/chats/[chatId]/variables/route.ts` and
  `src/app/api/personas/[personaId]/route.ts` still do manual object inspection instead of schema
  parsing

### P0-2. Add Direct Coverage to Chat Mutation Surfaces

Scope:

- `src/app/dashboard/chats/[id]/summary-actions.ts`
- `src/app/dashboard/chats/[id]/message-actions.ts`
- `src/app/dashboard/chats/actions.ts`
- `src/app/dashboard/chats/[id]/actions.ts`
- follow-on target: `src/app/api/messages/translate/route.ts`

Why:

- the coverage gate is green, but several mutation-bearing files still have no direct coverage
- these files perform auth, ownership checks, deletes, regeneration triggers, model-config writes,
  and revalidation
- the original review asked for direct tests on `0%` production files; that request is still open
  in the chat mutation surface

Done when:

- auth and ownership branches are covered directly
- destructive and regeneration flows assert side effects instead of only happy-path UI behavior
- action-state error contracts are locked with tests
- the next coverage run no longer shows these chat mutation files at `0%`

Current evidence as of `2026-04-14`:

- `src/app/dashboard/chats/actions.ts`: `0%`
- `src/app/dashboard/chats/[id]/actions.ts`: `0%`
- `src/app/dashboard/chats/[id]/message-actions.ts`: `0%`
- `src/app/dashboard/chats/[id]/summary-actions.ts`: `0%`
- `src/app/api/messages/translate/route.ts`: `72.72%`

## P1

### P1-1. Replace Runtime Double-Casts with Typed Adapters

Scope:

- `src/app/api/summaries/generate/route.ts`
- `src/lib/embeddings.ts`
- `src/lib/chat/translation-service.ts`
- `src/app/api/internal/chat-job-runner/vault.ts`
- `src/lib/monitoring/service-health-store.ts`
- `src/lib/chat/turn-projection.ts`
- `src/lib/chat/turn-projection-query.ts`
- `src/app/api/chats/[chatId]/export/route.ts`
- `src/app/dashboard/api-keys/actions.ts`

Why:

- the review called out RPC and Supabase response typing as a weak point
- that is still true in current production code even after the broader hardening work landed
- keeping these casts in narrow helpers is acceptable; leaving them spread through routes and query
  assembly code is not

Done when:

- typed RPC helpers exist for repeated Vault and service-health calls
- projected-chat query helpers no longer cast whole PostgREST chains to ad-hoc `Promise<...>` types
- remaining `as unknown as` in runtime code is limited to small interoperability seams and is easy to
  justify case by case

Current evidence as of `2026-04-14`:

- runtime `as unknown as` remains in `middleware.ts`, `service-health-store.ts`, `embeddings.ts`,
  `summaries/generate/route.ts`, `translation-service.ts`, `turn-projection.ts`,
  `turn-projection-query.ts`, `chat-job-runner/vault.ts`, `api-keys/actions.ts`, and
  `chats/[chatId]/export/route.ts`

### P1-2. Centralize Remaining Chat and Runner Limits

Scope:

- `src/app/api/chat/route.ts`
- `src/app/api/messages/reprocess/route.ts`
- `src/app/api/summaries/generate/route.ts`
- `src/app/api/internal/chat-job-runner/execution-context.ts`
- `src/app/dashboard/chats/[id]/hooks/job-poller.ts`
- `src/lib/chat/rate-limiter.ts`
- `src/lib/chat-summaries/config.ts`

Why:

- import limits are already centralized, so the review item is now narrower than it was on
  `2026-04-12`
- the remaining sprawl is concentrated in chat request size, token budget, polling timeout, stream
  update interval, and rate-limit window values
- this is still operationally relevant, but it no longer needs a repo-wide constants rewrite

Done when:

- chat and runner budgets live in one small config surface or clearly named module set
- operational tuning no longer requires searching multiple unrelated files
- the docs point to one place for supported tuning knobs

Current evidence as of `2026-04-14`:

- `src/app/api/chat/route.ts` still owns `MAX_MESSAGE_BYTES` and `MAX_CHAT_REQUEST_BODY_BYTES`
- `src/app/api/messages/reprocess/route.ts` still owns `STREAM_UPDATE_INTERVAL_MS`
- `src/app/api/internal/chat-job-runner/execution-context.ts` still owns `MAX_TOTAL_INPUT_TOKENS`
- `src/app/dashboard/chats/[id]/hooks/job-poller.ts` still owns timeout/backoff policy
- `src/lib/chat/rate-limiter.ts` still owns request-window constants separately

### P1-3. Finish the Last Useful Chat Shell Split

Scope:

- `src/app/dashboard/chats/[id]/ChatInterface.tsx`
- likely extracted seams around asset loading, realtime wiring, and usage refresh

Why:

- this is no longer the emergency it was on `2026-04-12`
- but `ChatInterface.tsx` is still the main first-class UI orchestration shell and still carries a
  lot of unrelated runtime wiring
- the next split should target orchestration concerns, not row rendering, because row rendering is
  already much smaller now

Done when:

- `ChatInterface.tsx` mostly composes hooks plus layout
- asset loading, realtime subscriptions, and usage refresh have explicit seams
- new chat-surface changes stop reopening unrelated top-level state branches

Current evidence as of `2026-04-14`:

- `ChatInterface.tsx` is down to `564` lines and no longer the same level of structural risk
- `MessageList.tsx` is `164` lines and `MessageBubble.tsx` is `143` lines, so row rendering is not
  the next bottleneck

## P2

### P2-1. Remove or Justify Remaining Manifest Noise

Scope:

- `package.json`
- `package-lock.json`
- matching docs or scripts if a dependency remains intentionally

Why:

- the earlier dependency cleanup landed, but at least one review-era candidate is still unresolved
- this is low risk compared to the items above, so it should stay small and explicit

Done when:

- unused root dependencies are removed, or
- the remaining ones are tied to an actual script/workflow in repo docs

Current evidence as of `2026-04-14`:

- `tsx` still appears in `package.json` and `package-lock.json`
- the current repo search does not show a live script or command using it directly

## Not Duplicated Here

These are real tasks, but they already have better owners elsewhere:

- visual direction, page-level polish, and responsive cleanup:
  [review-followups.md](./review-followups.md)
- first-class operator runbook and non-review operating work:
  [FIRST_CLASS_HARDENING_BACKLOG.md](./FIRST_CLASS_HARDENING_BACKLOG.md)
