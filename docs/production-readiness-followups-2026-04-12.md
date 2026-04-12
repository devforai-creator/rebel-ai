# Production Readiness Follow-ups

Updated: 2026-04-12

This document turns the latest production-readiness gate review into execution batches.

It is intentionally narrower than [production-audit-backlog-2026-04-12.md](/home/tmdduq96kr/projects/rebel-ai/docs/production-audit-backlog-2026-04-12.md):

- that backlog tracks the broader architectural hardening program
- this backlog tracks the remaining work needed to close the current review findings cleanly

Do not mix visual polish work into the gate-closing batches below. Restore green verification and tighten the remaining boundary mismatches first.

## Current Review Delta

The current review did not find a rewrite-level problem. It found a codebase that is close to production-ready but still blocked by a few concrete issues:

- the declared verification gate is not fully green in the current repo state
- `typecheck` still depends on generated `.next` artifacts
- some docs now lag behind the actual runtime and import contract
- one server-action validation path still diverges from the shared form pattern
- several operator-facing UI flows still rely on browser `alert` / `confirm`
- the main chat UI surfaces are still large enough to keep change cost high

## Working Rules

- P0 means "close a gate or remove a correctness risk before further polish"
- every behavior fix must land with regression coverage in the same change
- docs-only cleanup is allowed in its own batch when it removes contract ambiguity
- do not start a visual redesign batch until the P0 items are done
- after P0, prefer refactors that reduce future UI change radius over raw line-count reduction

## P0

### P0-1. Restore a Fully Green Verification Gate

Scope:

- [vitest.config.ts](/home/tmdduq96kr/projects/rebel-ai/vitest.config.ts)
- low-coverage runtime modules identified in the latest `npm run test -- --coverage` run
- CI wiring in [.github/workflows/test.yml](/home/tmdduq96kr/projects/rebel-ai/.github/workflows/test.yml) if command sequencing needs clarification

Why:

- the current repository does not pass its own declared coverage gate
- this is a production-readiness blocker even though many individual tests are strong

Done when:

- `npm run test -- --coverage` passes without lowering thresholds casually
- any threshold change is justified by support level and committed explicitly
- new tests target real risk surfaces rather than superficial coverage padding

Suggested first targets:

- [src/lib/lorebook/runtime.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/lorebook/runtime.ts)
- [src/lib/modules/orphan-cleanup.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/modules/orphan-cleanup.ts)
- [src/lib/suu-import-validation.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/suu-import-validation.ts)
- [src/lib/monitoring/service-health-store.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/monitoring/service-health-store.ts)

### P0-2. Make Typecheck Order-Independent

Scope:

- [tsconfig.json](/home/tmdduq96kr/projects/rebel-ai/tsconfig.json)
- [package.json](/home/tmdduq96kr/projects/rebel-ai/package.json)
- any supporting script or verification docs that define the expected command order

Why:

- a clean checkout should not need `build` before `typecheck`
- the current `.next/types/**/*.ts` inclusion makes the contract implicit and brittle

Done when:

- `npm run typecheck` passes on a clean checkout without requiring pre-generated `.next` files
- the expected command order in local development and CI is explicit and mechanical
- `npm run verify` remains accurate instead of relying on workspace residue

Current status as of 2026-04-12:

- [package.json](/home/tmdduq96kr/projects/rebel-ai/package.json) now runs `next typegen && tsc --noEmit` for `npm run typecheck`, so route/layout types are generated before TypeScript checks instead of being inherited from a previous build
- [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md) and [docs/DB_CHANGE_WORKFLOW.md](/home/tmdduq96kr/projects/rebel-ai/docs/DB_CHANGE_WORKFLOW.md) now point contributors at `npm run typecheck` instead of raw `tsc`, which keeps the human-facing workflow aligned with the mechanical command

### P0-3. Remove Documentation Drift from Live Contracts

Scope:

- [docs/rbx-spec.md](/home/tmdduq96kr/projects/rebel-ai/docs/rbx-spec.md)
- [DATABASE_SCHEMA.md](/home/tmdduq96kr/projects/rebel-ai/DATABASE_SCHEMA.md)
- [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md) if command or support-level language needs alignment

Why:

- the RBX spec still describes import-time SUU validation as missing even though it is implemented
- schema and support docs should not force future readers to guess which contract is current

Done when:

- docs reflect the current import-time SUU validation behavior
- any still-open runtime mismatch is called out once in the canonical document, not scattered
- dated references that imply stale schema or support assumptions are corrected

### P0-4. Resolve Module Priority Direction as a Single Runtime Contract

Scope:

- [src/app/api/chats/[chatId]/assets/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/assets/route.ts)
- [src/lib/lorebook/runtime.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/lorebook/runtime.ts)
- [src/app/dashboard/characters/[id]/CharacterDetailContent.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailContent.tsx)
- [src/app/dashboard/characters/[id]/lorebook/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/lorebook/page.tsx)
- related tests and docs

Why:

- the repo currently documents priority-direction inconsistency instead of locking one rule
- this is a subtle correctness problem that can surface as "same data, different behavior" across runtime and operator views

Done when:

- one priority rule is chosen and applied consistently in runtime, APIs, and operator screens
- tests lock the chosen ordering rule directly
- the RBX spec and any UI/operator docs match the runtime behavior

## P1

### P1-1. Normalize Server Action Validation Patterns

Scope:

- [src/app/dashboard/feedback/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/feedback/actions.ts)
- any remaining server actions that still parse `FormData` manually instead of using shared helpers
- [docs/review-followups.md](/home/tmdduq96kr/projects/rebel-ai/docs/review-followups.md) once the batch lands

Why:

- the repo already has a better `FormData + zod` pattern
- leaving one-off action parsing behind weakens modifiability and reviewability

Done when:

- feedback actions use the shared validation pattern
- field-level errors and auth handling follow the same structure as the hardened actions
- regression coverage locks the behavior

### P1-2. Replace Browser Dialog Flows with a Shared Interaction Pattern

Scope:

- [src/app/dashboard/api-keys/ApiKeyList.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/ApiKeyList.tsx)
- [src/app/dashboard/account/DeleteAccountButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/DeleteAccountButton.tsx)
- [src/app/dashboard/chats/[id]/DeleteChatButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/DeleteChatButton.tsx)
- [src/app/dashboard/chats/[id]/ChatInterface.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)
- similar destructive or error-reporting surfaces found in the latest repo search

Why:

- browser `alert` / `confirm` is not just a styling problem; it also fragments state handling and operator experience
- these flows now sit on core product surfaces

Done when:

- destructive confirmations use one shared dialog approach
- mutation failures use one shared toast or inline-feedback pattern
- tests cover the behavior where the old browser dialog path previously short-circuited control flow

## P2

### P2-1. Continue Decomposing the Main Chat UI by Feature Boundary

Scope:

- [src/app/dashboard/chats/[id]/ChatInterface.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx)
- [src/app/dashboard/chats/[id]/components/MessageList.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageList.tsx)
- adjacent hooks/components under [src/app/dashboard/chats/[id]](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id])

Why:

- these are still the highest-change UI surfaces
- future UX work will be expensive until their state, rendering, and mutation boundaries are cleaner

Done when:

- each file is closer to a state/orchestration shell than a mixed render-and-mutations monolith
- destructive actions, message tools, and side panels can evolve without touching unrelated chat branches
- new UI work stops increasing the change radius of the chat surface

Suggested seams:

- message actions
- destructive confirmations
- mutation feedback and optimistic state
- side-panel state
- debug / operator-only affordances

### P2-2. Lock a Minimal Product UI System Before Visual Redesign

Scope:

- shared app UI primitives already used on dashboard pages
- chat, settings, account, and API-key surfaces
- any local styles or class patterns that currently encode repeated visual rules ad hoc

Why:

- the repo is now at the point where raw "make it prettier" work would be wasteful without shared interaction and layout rules
- a small design system pass will make later visual improvement cheaper and more coherent

Done when:

- button priority, destructive-action treatment, panel spacing, form feedback, and empty/loading states follow a shared rule set
- the core dashboard surfaces stop inventing their own local interaction language
- later visual polish can be applied through system changes rather than one-off overrides

## P3

### P3-1. Product UI Improvement Pass

Scope:

- the first-class user flows only
- especially chat, API key management, character detail, and account surfaces

Why:

- the current UI is functional but still reads as utilitarian
- after the gate-closing and structure batches are done, this will likely become the highest-ROI product quality improvement

Done when:

- the first-class flows have a deliberate visual hierarchy instead of default utility styling
- typography, spacing, density, and emphasis feel intentional across the product
- "pretty" improvements do not reintroduce structural inconsistency or local hacks

Rule for this batch:

- do not start it until P0 is complete
- do not use it to hide unresolved structural or validation debt

## Out of Scope for This Repo Backlog

- a separate SUU-library audit or hardening plan

That work is adjacent and valuable, but it should be tracked in the SUU codebase itself rather than folded into this repo's gate-closing backlog.
