# Production Readiness Follow-ups

Updated: 2026-04-12

This document turns the latest production-readiness gate review into execution batches.

It is intentionally narrower than [production-audit-backlog-2026-04-12.md](../backlogs/archive/2026/production-audit-backlog-2026-04-12.md):

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
- [review-followups.md](./review-followups.md) once the batch lands

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

Execution rule:

- do not treat this as a visual redesign batch
- prefer extracting a small shared dashboard UI layer over restyling one screen at a time
- land it as narrow batches below rather than one large "UI cleanup" diff

### P2-2a. Define the Shared Dashboard UI Contract

Scope:

- [src/app/dashboard/components/ConfirmDialog.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ConfirmDialog.tsx)
- the shared dashboard component layer under [src/app/dashboard/components](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components)
- first reference surfaces that currently encode the button and panel rules ad hoc, especially [SummaryPromptsEditor.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryPromptsEditor.tsx), [ApiKeyList.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/ApiKeyList.tsx), and [ChatSummariesPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx)

Why:

- the repo now has repeated dashboard interaction patterns but no explicit product-level contract for them
- later UI work will stay expensive until button priority, panel shells, and feedback tone are encoded once

Done when:

- one shared rule exists for `primary`, `secondary`, `destructive`, and low-emphasis actions
- one shared panel/card shell exists for section-level surfaces instead of repeated local `rounded`, `border`, and `padding` combinations
- one shared inline feedback pattern exists for success, warning, and error messaging on dashboard forms and tools
- the batch leaves behind a clear place to extend the product UI system without reaching into unrelated feature folders

Current status as of 2026-04-12:

- the shared dashboard UI layer now exists in [Button.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/Button.tsx), [SurfaceCard.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/SurfaceCard.tsx), [InlineFeedback.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/InlineFeedback.tsx), and [classNames.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/classNames.ts), giving the repo one explicit source of truth for button hierarchy, card shells, and inline status treatment
- [ConfirmDialog.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ConfirmDialog.tsx) now consumes the shared primitives instead of encoding its own modal action styles, so destructive and primary confirmations inherit the same contract as the rest of the dashboard
- the first reference surfaces in [SummaryPromptsEditor.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryPromptsEditor.tsx), [AddApiKeyForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/AddApiKeyForm.tsx), [ApiKeyList.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/ApiKeyList.tsx), [ChatSummariesPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx), and [MemorySections.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MemorySections.tsx) now use the shared contract instead of repeated local button/card class bundles
- regression coverage for the new primitives now lives in [ui-primitives.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ui-primitives.test.tsx), and the existing memory-panel regression tests in [MemorySections.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MemorySections.test.tsx) still pass against the shared button/card primitives

### P2-2b. Normalize Account and API-Key Surfaces Against the Shared Contract

Scope:

- [src/app/dashboard/account/DeleteAccountButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/DeleteAccountButton.tsx)
- [src/app/dashboard/account/SummaryPromptsEditor.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryPromptsEditor.tsx)
- [src/app/dashboard/account/ChangePasswordForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ChangePasswordForm.tsx)
- [src/app/dashboard/account/RagSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/RagSettingsForm.tsx)
- [src/app/dashboard/account/ReprocessSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ReprocessSettingsForm.tsx)
- [src/app/dashboard/account/SummaryModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryModelSettingsForm.tsx)
- [src/app/dashboard/account/TranslationModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/TranslationModelSettingsForm.tsx)
- [src/app/dashboard/api-keys/AddApiKeyForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/AddApiKeyForm.tsx)
- [src/app/dashboard/api-keys/ApiKeyList.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/ApiKeyList.tsx)
- [src/app/dashboard/api-keys/GoogleApiKeySidePanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/GoogleApiKeySidePanel.tsx)

Why:

- these are dense operator-facing forms where visual inconsistency immediately turns into slower comprehension and weaker perceived quality
- they are also the fastest place to prove whether the shared contract is actually usable before pushing it into chat and character surfaces

Done when:

- save, reset, cancel, and destructive actions follow the same priority rules across account and API-key pages
- form-level errors, success feedback, disabled states, and loading labels read as one product instead of per-file inventions
- side-panel and section-card spacing matches the shared dashboard shell from `P2-2a`

Current status as of 2026-04-12:

- the remaining account forms in [ChangePasswordForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ChangePasswordForm.tsx), [RagSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/RagSettingsForm.tsx), [ReprocessSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ReprocessSettingsForm.tsx), [SummaryModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryModelSettingsForm.tsx), and [TranslationModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/TranslationModelSettingsForm.tsx) now use the shared `Button`, `InlineFeedback`, and dashed `SurfaceCard` patterns instead of bespoke local button and status-box classes
- destructive account cleanup in [DeleteAccountButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/DeleteAccountButton.tsx) now inherits the shared destructive button contract instead of carrying its own isolated red-button implementation
- the API-key surfaces now use the same contract not only for create/list flows but also for guidance chrome: [AddApiKeyForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/AddApiKeyForm.tsx) now treats the setup guide trigger as a shared secondary action, and [GoogleApiKeySidePanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/GoogleApiKeySidePanel.tsx) now uses shared button, card, and inline-feedback patterns for its header actions, progress shell, step CTA, and informational callouts
- regression coverage for the settings-form copy contracts still passes in [ReprocessSettingsForm.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ReprocessSettingsForm.test.tsx), [SummaryModelSettingsForm.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryModelSettingsForm.test.tsx), and [TranslationModelSettingsForm.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/TranslationModelSettingsForm.test.tsx), while the shared primitive contract remains locked in [ui-primitives.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ui-primitives.test.tsx)

### P2-2c. Normalize Chat-Adjacent Panels and Overlays

Scope:

- [src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx)
- [src/app/dashboard/chats/[id]/DeleteChatButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/DeleteChatButton.tsx)
- [src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx)
- [src/app/dashboard/chats/[id]/LorebookPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/LorebookPanel.tsx)
- [src/app/dashboard/chats/[id]/components/TokenStatsPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/TokenStatsPanel.tsx)
- [src/app/dashboard/chats/[id]/components/DebugModal.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/DebugModal.tsx)
- [src/app/dashboard/components/ConfirmDialog.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ConfirmDialog.tsx) as the shared destructive-overlay anchor

Why:

- the chat screen is now structurally easier to change, but its side panels and overlays still carry their own local spacing and feedback language
- this is the highest-frequency dashboard surface after the main message stream, so inconsistency here is expensive

Done when:

- side panels, modal shells, and destructive flows on the chat screen follow one spacing and action hierarchy
- empty and loading states inside chat-adjacent tools stop using local one-off copy/layout patterns
- chat-surface polish can proceed later without reopening basic UI-contract questions

Current status as of 2026-04-12:

- [DeleteChatButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/DeleteChatButton.tsx) and [SystemPromptEditorButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx) now use the shared button contract for both inline actions and menu-item variants instead of carrying separate local button-class bundles
- the chat-side overlay shells in [SystemPromptEditorButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx) and [DebugModal.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/DebugModal.tsx) now inherit the same `SurfaceCard` and button hierarchy as the rest of the dashboard, including shared close actions and shared info-state treatment when server debug data is missing
- the lorebook surfaces in [LorebookPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/LorebookPanel.tsx) and [LorebookPanelContent.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/LorebookPanelContent.tsx) now use shared icon buttons, mobile panel chrome, and explicit dashed empty states instead of local `hover:bg-muted` controls and placeholder `Empty.` text
- [TokenStatsPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/TokenStatsPanel.tsx) now routes its stats toggle and developer asset-diagnostics CTA through the shared button contract, reducing one-off hover and warning-button styling on the highest-frequency chat side surface
- regression coverage for these chat-adjacent UI contracts now lives in [chat-adjacent-ui.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/chat-adjacent-ui.test.tsx), while existing render coverage in [LorebookEntryRow.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/LorebookEntryRow.test.tsx), [MemorySections.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MemorySections.test.tsx), and [ui-primitives.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ui-primitives.test.tsx) still passes against the shared primitives

### P2-2d. Normalize Character List and Detail Surfaces

Scope:

- [src/app/dashboard/characters/CharacterCard.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterCard.tsx)
- [src/app/dashboard/characters/CharacterForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterForm.tsx)
- [src/app/dashboard/characters/CharacterImport.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterImport.tsx)
- [src/app/dashboard/characters/[id]/CharacterDetailView.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailView.tsx)
- [src/app/dashboard/characters/[id]/ChatImportModal.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/ChatImportModal.tsx)
- [src/app/dashboard/characters/[id]/NewChatButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/NewChatButton.tsx)

Why:

- character management mixes discovery, editing, destructive actions, and chat bootstrapping in one product area
- if these surfaces keep separate card, header, and action conventions, later visual improvement will stay fragmented

Done when:

- list cards and detail panels share the same shell density and action hierarchy
- character creation, import, and destructive flows use the shared form and confirmation language
- moving between list, detail, and related modals feels like one system instead of adjacent pages with different local rules

Current status as of 2026-04-12:

- [CharacterCard.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterCard.tsx), [CharacterForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterForm.tsx), and [CharacterImport.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterImport.tsx) now inherit the shared `SurfaceCard`, `Button`, and `InlineFeedback` contract instead of keeping separate local card shells, destructive buttons, and form-status boxes
- [CharacterDetailView.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailView.tsx) now uses the same panel density and button hierarchy for edit mode, lorebook management, chat import, empty chat history, chat export/delete, and load-more pagination, reducing the number of one-off button bundles on the character detail screen
- [ChatImportModal.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/ChatImportModal.tsx) and [NewChatButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/NewChatButton.tsx) now reuse the shared modal shell and primary/secondary action styling, so chat bootstrapping from character detail no longer looks like a separate UI system
- regression coverage for this batch now lives in [character-ui.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/character-ui.test.tsx) and [character-detail-ui.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/character-detail-ui.test.tsx), locking the shared contract on the character list, form, import, modal, and new-chat entry points

### P2-2e. Lock Shared Empty, Loading, and Error-State Language

Scope:

- [src/app/dashboard/characters/loading.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/loading.tsx)
- [src/app/dashboard/characters/error.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/error.tsx)
- [src/app/dashboard/chats/new/loading.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/loading.tsx)
- [src/app/dashboard/chats/[id]/ChatSummariesPanelLoader.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanelLoader.tsx)
- [src/app/dashboard/chats/[id]/LorebookPanelLoader.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/LorebookPanelLoader.tsx)
- [src/app/dashboard/chats/[id]/components/LorebookPanelContent.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/LorebookPanelContent.tsx)
- any equivalent first-class dashboard empty/loading/error surface touched by `P2-2b` through `P2-2d`

Why:

- users read loading and empty states as part of the interface contract, not as implementation leftovers
- if these states remain inconsistent, the product will still feel improvised even after buttons and cards are normalized

Done when:

- first-class dashboard surfaces use one clear pattern for "loading", "empty", and recoverable failure states
- terse placeholder copy like `Empty.` and ad hoc loading language is replaced by deliberate product wording
- later polish work can change tone and visuals centrally without hunting for state-specific one-offs

Current status as of 2026-04-12:

- shared state primitives now live in [EmptyState.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/EmptyState.tsx), [LoadingState.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/LoadingState.tsx), and [ErrorState.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ErrorState.tsx), giving the dashboard one reusable shell for empty, loading, and recoverable error surfaces
- page-level states in [src/app/dashboard/characters/loading.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/loading.tsx), [src/app/dashboard/characters/error.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/error.tsx), [src/app/dashboard/chats/new/loading.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/loading.tsx), and [src/app/dashboard/chats/error.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/error.tsx) now use explicit product copy instead of anonymous skeletons or one-off retry cards
- state surfaces inside first-class chat and character flows now reuse the same language and shell: [CharactersPage](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/page.tsx) for an empty library, [CharacterDetailView](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailView.tsx) for empty chat history, [ChatSummariesPanel](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx) for no long-term memory yet, [LorebookPanelContent](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/LorebookPanelContent.tsx) for empty folder/filter views, and [src/app/dashboard/chats/[id]/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/page.tsx) for the memory-panel suspense fallback
- regression coverage now locks the shared state primitives in [ui-primitives.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ui-primitives.test.tsx), while [chat-adjacent-ui.test.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/chat-adjacent-ui.test.tsx) was updated to assert the new lorebook empty-state wording

Suggested execution order:

1. `P2-2a`
2. `P2-2b`
3. `P2-2c`
4. `P2-2d`
5. `P2-2e`

Cut line for this phase:

- stop once the shared contract exists and the first-class dashboard surfaces use it consistently
- do not spill into raw "make it prettier" work until `P3-1`

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

Recommended execution principle:

- move from shared visual direction to the highest-frequency product surface, then outward
- treat this as product-interface work, not a one-off "make it pretty" paint pass
- keep behavior stable unless a layout or wording problem is directly causing user friction

### P3-1a. Establish the Shared Visual Direction

Scope:

- first-class dashboard page shells and section headers
- [src/app/dashboard/components/SurfaceCard.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/SurfaceCard.tsx)
- [src/app/dashboard/components/Button.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/Button.tsx)
- [src/app/dashboard/components/EmptyState.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/EmptyState.tsx)
- [src/app/dashboard/components/LoadingState.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/LoadingState.tsx)
- [src/app/dashboard/components/ErrorState.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/components/ErrorState.tsx)
- page-level wrappers that set the visual density for [account/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/page.tsx), [api-keys/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/page.tsx), [characters/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/page.tsx), and [chats/[id]/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/page.tsx)

Why:

- later surface-by-surface polish will fragment immediately unless one typography, spacing, and emphasis direction is chosen first
- this is the phase where the dashboard should stop looking like adjacent cards on a neutral canvas and start reading as one product

Done when:

- page titles, supporting copy, section rhythm, and card density follow one deliberate visual system
- the shared button and card primitives gain a stronger product voice without breaking the P2 interaction contract
- empty/loading/error shells still feel like the same system, but no longer read as generic utility boxes

Guardrails:

- do not redesign individual feature flows yet
- do not add one-off colors, fonts, or shadows at the page level that bypass the shared primitives

### P3-1b. Improve the Chat Workspace Hierarchy

Scope:

- [src/app/dashboard/chats/[id]/ChatInterface.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx)
- [src/app/dashboard/chats/[id]/components/MessageList.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageList.tsx)
- [src/app/dashboard/chats/[id]/components/MessageBubble.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/MessageBubble.tsx)
- [src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx)
- adjacent chat-side tools already normalized in `P2-2c`

Why:

- chat is the highest-frequency product surface and currently the most visible place where the UI still reads as utilitarian
- once the shared visual direction exists, chat is where hierarchy, density, and emphasis will either prove out or fail

Done when:

- the message stream, composer, and side-memory tools have a clear primary/secondary visual hierarchy
- operator-only controls and debug affordances remain available but visually subordinate to the core conversation flow
- message spacing, role distinction, streaming state, and action affordances feel intentional instead of inherited from default utility classes

Guardrails:

- do not reopen the `P2-1` decomposition unless a renderer-specific branch directly blocks the visual pass
- keep message semantics, moderation behavior, and action wiring unchanged

### P3-1c. Improve Character Discovery and Detail Flow

Scope:

- [src/app/dashboard/characters/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/page.tsx)
- [src/app/dashboard/characters/CharacterCard.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterCard.tsx)
- [src/app/dashboard/characters/CharacterForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterForm.tsx)
- [src/app/dashboard/characters/CharacterImport.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterImport.tsx)
- [src/app/dashboard/characters/[id]/CharacterDetailView.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailView.tsx)
- [src/app/dashboard/characters/[id]/ChatImportModal.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/ChatImportModal.tsx)

Why:

- this area carries the second-most important user journey after chat: discover a character, inspect it, modify it, then start or import a conversation
- the current screens are functionally coherent but still read as operator tooling instead of a polished product flow

Done when:

- list cards, import/create flows, and the detail screen feel like one connected experience
- character metadata, system prompt, linked resources, and chat history have a clearer visual order
- the transition from browsing a character to starting or importing a chat feels intentionally guided

Guardrails:

- do not widen the feature scope beyond the first-class character flows
- keep the shared destructive and feedback patterns from `P2-2d` intact

### P3-1d. Improve Settings and API-Key Operator Surfaces

Scope:

- [src/app/dashboard/account/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/page.tsx)
- [src/app/dashboard/account/SummaryPromptsEditor.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryPromptsEditor.tsx)
- [src/app/dashboard/account/ChangePasswordForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ChangePasswordForm.tsx)
- [src/app/dashboard/account/RagSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/RagSettingsForm.tsx)
- [src/app/dashboard/account/ReprocessSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ReprocessSettingsForm.tsx)
- [src/app/dashboard/account/SummaryModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryModelSettingsForm.tsx)
- [src/app/dashboard/account/TranslationModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/TranslationModelSettingsForm.tsx)
- [src/app/dashboard/api-keys/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/page.tsx)
- [src/app/dashboard/api-keys/ApiKeyList.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/ApiKeyList.tsx)
- [src/app/dashboard/api-keys/AddApiKeyForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/AddApiKeyForm.tsx)
- [src/app/dashboard/api-keys/GoogleApiKeySidePanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/GoogleApiKeySidePanel.tsx)

Why:

- these pages are dense and information-heavy, so weak hierarchy quickly turns into fatigue even when the interaction contract is already correct
- a better product UI here is less about decoration and more about making risk, guidance, and primary tasks obvious

Done when:

- account and API-key surfaces read as curated task areas instead of stacked forms
- supporting copy, hints, and danger zones are visually clearer without becoming louder than the primary actions
- users can scan what each settings block does before reading the full body copy

Guardrails:

- do not reintroduce local visual rules that diverge from `P3-1a`
- keep the action hierarchy stable so the visual pass does not become a behavior change

### P3-1e. Responsive Cohesion and Final First-Class Pass

Scope:

- the desktop and mobile layouts for the `P3-1a` through `P3-1d` surfaces
- the first-class empty/loading/error states after the new visual language lands
- any small cleanup needed to remove visual drift introduced during the earlier `P3-1` slices

Why:

- visual improvement work often looks coherent on desktop while regressing on mobile density, scroll depth, or action reachability
- this pass is where the product should be checked as one connected dashboard rather than as individual polished screens

Done when:

- the first-class flows feel visually related on both desktop and mobile instead of as separate layout variants
- action reachability, panel collapse behavior, and empty/loading/error presentations remain clear at smaller sizes
- there are no obvious style regressions or one-off patches left behind from the earlier `P3-1` slices

Suggested execution order:

1. `P3-1a`
2. `P3-1b`
3. `P3-1c`
4. `P3-1d`
5. `P3-1e`

## Out of Scope for This Repo Backlog

- a separate SUU-library audit or hardening plan

That work is adjacent and valuable, but it should be tracked in the SUU codebase itself rather than folded into this repo's gate-closing backlog.
