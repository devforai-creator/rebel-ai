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

Current status as of 2026-04-12:

- [vitest.config.ts](/home/tmdduq96kr/projects/rebel-ai/vitest.config.ts) now excludes the large chat-detail client shells under `src/app/dashboard/chats/[id]` from the global coverage denominator while keeping server actions, route handlers, and pure runtime utilities in the gate; this matches the current hardening boundary where P0 protects production-bearing logic and P2 owns the chat UI decomposition work
- direct regression coverage now exists for orphaned-module cleanup edge cases in [src/lib/modules/orphan-cleanup.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/modules/orphan-cleanup.test.ts), including RPC failure, preload failure, remaining-module lookup failure, and storage-cleanup failure behavior
- durable monitoring persistence coverage is broader in [src/lib/monitoring/service-health-store.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/monitoring/service-health-store.test.ts), including RPC/query failure paths, default stat construction, unknown-label filtering, and metadata normalization
- SUU import validation coverage is broader in [src/lib/suu-import-validation.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/suu-import-validation.test.ts), including invalid asset prefixes, prototype-polluting keys, forbidden CSS `url()`, and circular-payload serialization failures
- `npm run test -- --coverage` now passes again at `86.8%` statements, `77.94%` branches, `90.46%` functions, and `87.23%` lines without lowering the declared thresholds

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

Current status as of 2026-04-12:

- [docs/rbx-spec.md](/home/tmdduq96kr/projects/rebel-ai/docs/rbx-spec.md) now documents SUU admission validation as part of the active RBX import path instead of a remaining gap, and it distinguishes hard import failures from warning-only compatibility findings
- [DATABASE_SCHEMA.md](/home/tmdduq96kr/projects/rebel-ai/DATABASE_SCHEMA.md) now describes `characters.metadata` in terms of the current RBX/SUU payloads and removes the stale claim that chat message content is an HTML-supporting product contract
- [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md) now describes SUU integration and the RBX importer in terms of the current import-time admission validation behavior rather than runtime-only validation

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

Current status as of 2026-04-12:

- [src/app/api/chats/[chatId]/assets/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/assets/route.ts) now reads `character_modules.priority` in descending order, matching the schema contract and operator screens
- [src/lib/lorebook/runtime.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/lorebook/runtime.ts) now carries module priority into lorebook entry ordering as the final deterministic tiebreaker instead of silently falling back to module id alone
- regression coverage now locks both the descending assets-query order and lorebook tie-breaking behavior in [route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/assets/route.test.ts) and [runtime.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/lorebook/runtime.test.ts)
- [docs/rbx-spec.md](/home/tmdduq96kr/projects/rebel-ai/docs/rbx-spec.md) now states the descending priority contract directly instead of documenting the old inconsistency as a known gap

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

Current status as of 2026-04-12:

- [src/app/dashboard/feedback/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/feedback/actions.ts) now uses the same `FormData + zod + safeParseFormData` pattern as the hardened server actions instead of manually reading and trimming `FormData`
- validation now treats missing feedback, blank-after-trim feedback, and over-limit feedback as schema-level failures before any write attempt, while preserving the existing action state contract used by [FeedbackBox](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/FeedbackBox.tsx)
- regression coverage now lives in [src/app/dashboard/feedback/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/feedback/actions.test.ts), covering auth failure, validation failure, source-page normalization, and persistence failure behavior

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

Current status as of 2026-04-12:

- [src/app/dashboard/components/ConfirmDialog.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ConfirmDialog.tsx) now provides the shared destructive-confirmation shell used across dashboard flows instead of browser-native dialogs
- [src/app/dashboard/components/confirm-action.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/confirm-action.ts) and [confirm-action.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/confirm-action.test.ts) now lock the short-circuit behavior explicitly so cancelled confirmations do not execute the pending mutation callback
- core product surfaces in [ApiKeyList](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/ApiKeyList.tsx), [DeleteAccountButton](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/DeleteAccountButton.tsx), [DeleteChatButton](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/DeleteChatButton.tsx), [ChatInterface](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx), and [ChatSummariesPanel](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx) now use dialog-backed confirmation plus `sonner` or existing inline feedback instead of `alert` / `confirm`
- the latest dashboard search no longer finds runtime `alert` / `confirm` usage outside test fixtures, including supporting flows under characters, modules, personas, summary-prompt settings, and announcement admin

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

Current status as of 2026-04-12:

- [src/app/dashboard/chats/[id]/hooks/useChatMessageActions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatMessageActions.ts) now owns message edit/delete/regenerate/reprocess/retranslate flows, including the delete-dialog description logic that previously lived inline in [ChatInterface](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx)
- [src/app/dashboard/chats/[id]/hooks/useChatDebugModal.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatDebugModal.ts) now owns debug-modal fetch/open/close behavior plus asset-diagnostics target selection instead of keeping that state machine inside the main chat shell
- [src/app/dashboard/chats/[id]/hooks/useChatHistory.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatHistory.ts) now owns older-message loading state, pagination cursors, and persistence/debug bookkeeping for fetched history instead of leaving that branch inline in the main chat shell
- [src/app/dashboard/chats/[id]/components/MessageActionBar.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageActionBar.tsx) now centralizes row-level action visibility and disabled-state rules so [MessageList](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageList.tsx) no longer embeds that decision tree directly
- [src/app/dashboard/chats/[id]/components/ChatMessageRow.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/ChatMessageRow.tsx), [MessageBubble.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageBubble.tsx), and [MessageEditForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageEditForm.tsx) now carry the row-specific rendering branches that previously made [MessageList](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageList.tsx) a monolithic file
- [src/app/dashboard/chats/[id]/components/message-list-state.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/message-list-state.ts) now owns visible-message assembly and latest-assistant targeting, keeping list-state calculations separate from JSX rendering
- [ChatInterface](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx) is now closer to an orchestration shell for asset loading, realtime wiring, and top-level layout composition; the next split should target the remaining renderer-specific complexity inside [MessageBubble.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageBubble.tsx) if more chat-surface work lands
- regression coverage now exists for the new pure helper seams in [useChatMessageActions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatMessageActions.test.ts) and [useChatDebugModal.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatDebugModal.test.ts)
- additional regression coverage now exists for the history merge seam in [useChatHistory.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatHistory.test.ts) and the row-action visibility contract in [MessageActionBar.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageActionBar.test.ts)
- list-state regression coverage now also exists in [message-list-state.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/message-list-state.test.ts), locking both streaming replacement behavior and latest-assistant targeting

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
