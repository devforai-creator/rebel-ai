# Dashboard State Predictability Backlog

Updated: 2026-04-19

This backlog turns the current declarative-flow and error-handling review into a bounded execution
queue for dashboard client state.

It is not a whole-dashboard rewrite plan.
It is the minimum backlog for the remaining places where local state ownership, optimistic updates,
or client-side error handling still make behavior harder to predict than it should be.

This document intentionally starts after the larger boundary cleanup already captured in:

- [chat-boundary-cleanup-checklist-2026-04-19.md](./chat-boundary-cleanup-checklist-2026-04-19.md)
- [dashboard-ui-boundary-backlog-2026-04-19.md](./dashboard-ui-boundary-backlog-2026-04-19.md)

Do not reopen those broader boundary splits from here.
This backlog is only about predictability of state flow and consistency of client-side failure
handling.

## Goals

- make the source of truth obvious in dashboard chat and settings UI
- reduce prop-to-state mirror effects that add no new ownership boundary
- unify client-side API error parsing and fallback messaging
- keep improvements bounded to real drift or predictability problems

## Non-Goals

- removing every `useEffect`
- replacing Supabase realtime or SWR across the repo
- rewriting stable server routes that already use shared API response helpers
- introducing a broad app-wide abstraction unless at least two real callers need the same behavior

## Working Rules

- treat source-of-truth clarity as the primary goal; line-count reduction is secondary
- if a local state value only mirrors props or action state, either remove it or justify its separate ownership
- optimistic updates must define one of: rollback, retry, or explicit eventual-consistency semantics
- for fetch and mutation failures, prefer one parsing path before inventing feature-local variations
- land regression coverage with any behavior-affecting cleanup in the same change
- if a slice changes internal routes, runner behavior, or deployment assumptions, run `npm run ops:smoke` after deploy before closing it

## Priority Order

### P0. Canonicalize Dashboard Client API Error Handling

Why first:

- this is the lowest-risk cleanup with the broadest local payoff
- the repo already has a shared error-reader, but dashboard callers still mix `response.text()`,
  hard-coded fallback strings, and route-specific parsing
- inconsistent failure handling makes UI behavior feel arbitrary even when the server contract is stable

Primary scope:

- [src/lib/http/api-contract.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/http/api-contract.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatMessageActions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatMessageActions.ts)
- [src/app/dashboard/chats/[id]/hooks/queued-chat-api.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/queued-chat-api.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatRuntimeVariables.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRuntimeVariables.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)
- [src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/SystemPromptEditorButton.tsx)
- [src/hooks/useUserResources.ts](/home/tmdduq96kr/projects/rebel-ai/src/hooks/useUserResources.ts)
- [src/hooks/useChatOptions.ts](/home/tmdduq96kr/projects/rebel-ai/src/hooks/useChatOptions.ts)

Entry checklist:

- [ ] define the preferred client-side rule for reading API failure messages
- [ ] list the routes that return JSON error payloads versus plain text
- [ ] identify where dashboard callers intentionally want custom toast copy instead of raw server text

Implementation checklist:

- [ ] extract or extend one narrow client-facing helper for `response -> user-facing message`
- [ ] replace raw `response.text()` and `response.statusText` handling in dashboard callers where the shared helper should apply
- [ ] keep feature-specific fallback wording only where the product intentionally wants it
- [ ] add focused tests for JSON error body, plain-text body, and empty-body fallback behavior

Done when:

- [ ] dashboard client mutations no longer open-code basic API error parsing in several different ways
- [ ] callers handling the same route family expose similar failure-message quality
- [ ] future route error-shape changes touch one shared client boundary instead of several hooks and components

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

### P1. Normalize `useActionState` Feedback Patterns in Settings Forms

Why second:

- several forms duplicate `state.success` or `state.error` into local `statusMessage` state
- this adds a second pseudo-source-of-truth even when the local value is only derived from server action state
- the cleanup is small and reduces future drift in success/error display rules

Primary scope:

- [src/app/dashboard/account/ChatUsageSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ChatUsageSettingsForm.tsx)
- [src/app/dashboard/account/RagSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/RagSettingsForm.tsx)
- [src/app/dashboard/account/ReprocessSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/ReprocessSettingsForm.tsx)
- [src/app/dashboard/account/SummaryModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/SummaryModelSettingsForm.tsx)
- [src/app/dashboard/account/TranslationModelSettingsForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/TranslationModelSettingsForm.tsx)
- [src/app/dashboard/api-keys/AddApiKeyForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/AddApiKeyForm.tsx)

Entry checklist:

- [ ] identify which forms truly need local transient feedback separate from server action state
- [ ] define the minimal shared mapping for `error / success / warning -> feedback tone`
- [ ] decide whether the right extraction is a helper, a small hook, or just local simplification

Implementation checklist:

- [ ] remove mirrored local feedback state where it only re-expresses `useActionState` output
- [ ] keep genuinely local pre-submit guidance separate from post-submit server feedback
- [ ] normalize feedback rendering so similar forms do not drift in tone and reset behavior
- [ ] add or update focused tests for visible success/error messaging if behavior changes

Done when:

- [ ] settings forms read as `draft state + server action state`, not `draft state + copied server action state`
- [ ] success and error rendering rules are easier to reuse and harder to drift
- [ ] local feedback state remains only where it owns behavior the server action state does not

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

### P1. Make Runtime Variable Persistence Semantics Explicit

Why third:

- the current runtime-variable flow updates local state immediately and only shows a toast on save failure
- that leaves the UI and server state able to drift without an explicit contract
- this is the clearest remaining predictability issue in the chat runtime UI

Primary scope:

- [src/app/dashboard/chats/[id]/hooks/useChatRuntimeVariables.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRuntimeVariables.ts)
- [src/app/api/chats/[chatId]/variables/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/variables/route.ts)

Entry checklist:

- [ ] decide whether save failure should roll back local state, mark local state as dirty, or retry
- [ ] define the intended source of truth for runtime variables during an in-flight save
- [ ] identify which current behavior must remain fast and optimistic for UI-card interactions

Implementation checklist:

- [ ] separate persisted state from optimistic draft state if both need to exist
- [ ] add rollback or explicit dirty-state semantics for failed saves
- [ ] reuse the shared client error parsing path from `P0`
- [ ] add targeted tests for save success, save failure, and follow-up user actions after failure

Done when:

- [ ] the runtime-variable source of truth can be described clearly in one sentence
- [ ] save failure no longer leaves silent divergence between local UI state and server state
- [ ] follow-up edits after a failed save behave predictably

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

### P2. Reduce Hidden State Synchronization in Chat Memory and Stats Hooks

Why last:

- the current hooks are workable, but their ownership boundaries are still harder to read than necessary
- this cleanup is more invasive than `P0` or `P1`, so it should start only after the lower-risk consistency work lands
- the goal is not to remove all local caching, only to make it easier to explain

Primary scope:

- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatUsageStats.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatUsageStats.ts)
- [src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx)

Entry checklist:

- [ ] map which values are server-truth, realtime cache, and UI-local edit state
- [ ] identify which prop-to-state mirror effects add real value versus pure duplication
- [ ] decide whether `useChatSummariesState` should keep local collections or rely more directly on loader data plus mutation boundaries

Implementation checklist:

- [ ] remove pure mirror effects where they do not create a meaningful ownership boundary
- [ ] if local caches remain, document and isolate their reconciliation rules
- [ ] make usage-stat fetch gating more declarative than ref-mirrored booleans where practical
- [ ] add or update tests around refresh, realtime reconciliation, and initial-value hydration

Done when:

- [ ] `useChatSummariesState` is easier to read as `server-backed cache + local edit state` rather than several overlapping state channels
- [ ] `useChatUsageStats` shows fetch conditions directly in its reactive inputs
- [ ] future changes to stats or summaries have a clearer place to land

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

## Stop Conditions

Pause before continuing to the next item if any of these become true:

- the cleanup starts inventing a generic framework instead of removing a concrete predictability problem
- a slice requires changing product semantics that have not been explicitly agreed
- tests become more coupled and harder to understand after the extraction
- a production issue or higher-priority contract change appears

## Current Recommendation

As of 2026-04-19:

- start with `P0 Canonicalize Dashboard Client API Error Handling`
- take `P1 Normalize useActionState Feedback Patterns` next if you want the lowest-risk follow-up
- treat `P1 Make Runtime Variable Persistence Semantics Explicit` as the highest-value behavioral cleanup after `P0`
- start `P2` only after the easier consistency work lands

## Follow-Up Notes

- If `P0` reveals a stable shared pattern for dashboard mutations, keep it narrow and client-facing rather than turning it into a broad app service layer.
- If `P1` on runtime variables exposes a product decision about offline edits, failed saves, or dirty indicators, capture that decision in a short design note before widening the cleanup.
- If additional predictability findings appear later, add them here only when they are bounded execution slices with clear ownership and clear done conditions.
