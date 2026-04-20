# Dashboard UI Boundary Backlog

Updated: 2026-04-19

This backlog turns the current SoC and SRP review into a bounded execution queue for the dashboard UI.

It is not a whole-dashboard rewrite plan.
It is the minimum backlog for removing the highest-value cases where UI components still own transport details, domain rules, or multiple user flows at once.

This document intentionally starts after the already-completed server-side convergence work in
[chat-boundary-cleanup-checklist-2026-04-19.md](./chat-boundary-cleanup-checklist-2026-04-19.md).
Do not reopen that larger chat-contract work from here.

## Goals

- reduce direct API protocol handling inside dashboard UI components
- keep domain validation and normalization rules in canonical non-UI boundaries
- split multi-purpose components along user-flow seams instead of line-count alone
- make future dashboard changes default to smaller, testable boundaries

## Non-Goals

- full dashboard folder reorganization
- introducing a generic repo-wide service layer
- rewriting stable presentational components that already have clear ownership
- changing product behavior just to satisfy stylistic purity

## Working Rules

- Prefer the smallest extraction that removes a real responsibility boundary.
- Do not create shared helpers unless at least two callers need the same behavior or contract.
- When moving transport logic, keep the caller-facing API narrower than the raw HTTP shape.
- Every boundary cleanup should land with the most direct regression coverage available in the same change.
- If a task changes internal routes, deployment assumptions, or runner wiring, run `npm run ops:smoke` after deploy before closing it.

## Priority Order

### P0. Split `ChatPersonaWidget` by User Flow

Why first:

- it still mixes two distinct use cases in one UI boundary
- it is one of the clearest remaining examples of `one component, multiple responsibilities`
- the server-side convergence already exists, so the cleanup should now be smaller and safer

Primary scope:

- [src/app/dashboard/chats/[id]/ChatPersonaWidget.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatPersonaWidget.tsx)
- [src/app/dashboard/chats/[id]/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/actions.ts)
- [src/app/dashboard/personas/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/personas/actions.ts)
- [src/lib/personas/update.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/personas/update.ts)

Entry checklist:

- [ ] confirm the canonical write path for persona edit from the chat screen
- [ ] identify which validation and normalization rules should come only from `src/lib/personas/update.ts`
- [ ] decide the final UI split between `select persona` and `edit persona`

Implementation checklist:

- [ ] split the current widget along user-flow seams instead of keeping both modes in one component
- [ ] remove direct persona update transport handling from the UI component
- [ ] reuse canonical persona validation constants and parsing rules where the UI needs limits or messages
- [ ] keep the chat persona attach flow and persona edit flow easy to test independently

Done when:

- [ ] chat persona selection and persona editing are no longer implemented as one mixed component flow
- [ ] persona update rules do not drift between chat UI and persona management UI
- [ ] the remaining UI boundary is orchestration-focused rather than transport-focused
- [ ] relevant tests cover invalid input and successful save/select behavior

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

### P1. Move Module Admin Transport out of `ModuleManagementSection`

Why second:

- it is a clean extraction with low behavior risk
- the component currently owns list loading, delete transport, payload parsing, and error handling
- this should shrink one of the clearest remaining dashboard `fetch-in-component` call sites

Primary scope:

- [src/app/dashboard/modules/ModuleManagementSection.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/modules/ModuleManagementSection.tsx)
- related route and tests under [src/app/api/modules](/home/tmdduq96kr/projects/rebel-ai/src/app/api/modules)

Entry checklist:

- [ ] choose whether the extraction should land as a feature hook or a narrow feature-local client
- [ ] define the caller-facing shape for `load modules` and `delete module`
- [ ] identify current response parsing and toast/error behavior that must remain stable

Implementation checklist:

- [ ] move module list fetch and delete mutation out of the component body
- [ ] keep the component responsible only for view state, confirmation flow, and render decisions
- [ ] centralize response-shape parsing and fallback error messages for this feature
- [ ] keep the write scope local to the modules feature rather than creating a broad shared abstraction

Done when:

- [ ] `ModuleManagementSection` no longer calls `fetch` directly
- [ ] list and delete operations expose a narrower feature boundary than raw HTTP
- [ ] response parsing changes would touch one local boundary instead of the UI component
- [ ] relevant tests lock the extracted behavior

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

### P1. Canonicalize System Prompt Override Semantics

Why third:

- the current UI decides a storage rule that is more domain-specific than visual
- the rule is small, but drift risk is high if another caller appears
- this is a low-cost way to prevent future contract duplication

Primary scope:

- [src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx)
- [src/app/api/chats/[chatId]/system-prompt/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/system-prompt/route.ts)
- new shared logic under [src/lib/chat](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat)

Entry checklist:

- [ ] define the exact canonical meaning of `custom system prompt override`
- [ ] decide whether the server route should enforce `default prompt -> null` semantics or just share the same normalizer
- [ ] identify all current callers that should use the same rule

Implementation checklist:

- [ ] extract the override normalization logic into one shared function
- [ ] make the UI use that shared function instead of open-coding the rule
- [ ] make the server boundary use or explicitly validate against the same semantics
- [ ] add targeted tests around blank, default-equal, and custom values

Done when:

- [ ] `default prompt means no override` is defined in one canonical place
- [ ] UI and server no longer risk semantic drift on override handling
- [ ] tests state the intended override contract directly

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

### P2. Trim `useCharacterChats` to an Orchestration Hook

Why last:

- the current hook is still workable, so this should not preempt clearer P0 or P1 cleanup
- the main risk is future growth, not current breakage
- this is a good follow-up once the sharper UI-boundary issues are already reduced

Primary scope:

- [src/app/dashboard/characters/[id]/hooks/useCharacterChats.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/hooks/useCharacterChats.ts)
- [src/app/dashboard/characters/[id]/CharacterDetailView.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/[id]/CharacterDetailView.tsx)

Entry checklist:

- [ ] confirm which responsibilities should remain in the hook versus a feature-local client or utility
- [ ] identify the current API, download, and pagination behaviors that must remain unchanged

Implementation checklist:

- [ ] extract chat export and page-load transport details out of the orchestration hook
- [ ] isolate blob download DOM handling from state orchestration
- [ ] keep delete-flow state in the hook only if it still improves the view boundary
- [ ] avoid splitting this feature into more files than the actual seams justify

Done when:

- [ ] `useCharacterChats` reads primarily as state orchestration
- [ ] API transport and download side effects are easier to test in isolation
- [ ] `CharacterDetailView` stays presentation-oriented and does not regain transport details

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

## Stop Conditions

Pause before continuing to the next item if any of these become true:

- the current extraction requires inventing a generic abstraction that only one feature uses
- tests become harder to understand because the boundary split is too fine-grained
- the work starts drifting into visual redesign instead of responsibility cleanup
- a higher-priority production bug or contract issue appears

## Recommendation

As of 2026-04-19:

- start with `P0 ChatPersonaWidget`
- do not begin with `useCharacterChats`
- keep this backlog local to dashboard responsibility cleanup, not chat-runtime redesign

## Follow-Up Notes

- If more dashboard features show the same `fetch in component` pattern after `P0` and `P1`, prefer adding them as new bounded entries here rather than reopening a whole-repo architecture review.
- If one of these items forces a broader product contract decision, move that decision into a dedicated design note or backlog instead of stretching this document.
