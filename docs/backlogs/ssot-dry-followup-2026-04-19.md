# SSoT / DRY Follow-Up Backlog

Updated: 2026-04-19

This backlog records the remaining high-value cleanup from the recent SSoT and DRY review.

It is not a whole-repo type-cleanup plan.
It is the minimum execution queue for the remaining places where canonical model-selection or
feature-local contracts are still duplicated enough to create drift risk.

This document intentionally starts after the already-completed local cleanup:

- `content_en` invalidation on message rewrites
- documentation of the accepted summary/fact invalidation tradeoff
- shared DTO convergence for `account`, `chat-options`, and `announcements`
- summary-provider contract tightening

Do not reopen those finished slices from this backlog.

## Goals

- keep `provider / model / service tier` selection rules in one canonical place where practical
- continue feature-scoped contract tightening without paying for a whole-repo rewrite
- reduce future drift when adding providers or changing fallback rules
- improve local DX by making canonical contracts easier to discover and reuse

## Non-Goals

- repo-wide replacement of every `provider: string`
- centralizing view-model or purely UI-local types
- rewriting experimental memory behavior into strict real-time consistency
- introducing a broad generic service layer with no clear second caller

## Working Rules

- prefer one bounded feature slice per session
- only extract shared logic when at least two real callers need the same rule
- keep raw DB shapes permissive when needed, but narrow contracts before runtime decisions
- land regression coverage with any behavior-affecting change
- if a slice changes internal routes, runner wiring, or deployment assumptions, run `npm run ops:smoke` after deploy before closing it

## Priority Order

### P0. Canonicalize LLM Config Resolution

Why first:

- this is the highest-value remaining SSoT gap from the review
- the same `api key -> provider / model / service tier` decision logic is still spread across multiple features
- future provider or fallback changes should not require touching several unrelated code paths

Primary scope:

- [src/lib/chat/summary-model-preference.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/summary-model-preference.ts)
- [src/app/dashboard/chats/[id]/summary-regeneration.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/summary-regeneration.ts)
- [src/lib/chat/translation-service.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-service.ts)
- [src/app/api/messages/reprocess/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/messages/reprocess/route.ts)
- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- new shared logic under [src/lib/chat](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat)

Entry checklist:

- [ ] define the exact canonical output shape for resolved LLM config
- [ ] decide which callers need `provider + modelName` only and which also need `serviceTier` or `apiKeyId`
- [ ] identify current fallback precedence differences that must remain intentional versus ones that should converge

Implementation checklist:

- [ ] extract one narrow shared resolver for active LLM config selection
- [ ] make summary, translation, reprocess, and chat-send paths use that resolver or an explicit wrapper around it
- [ ] remove duplicated default-model fallback logic where the resolver becomes canonical
- [ ] keep embedding-only providers rejected at the canonical boundary rather than at scattered call sites

Done when:

- [ ] changing provider fallback rules no longer requires editing several feature paths
- [ ] model selection semantics are described by one shared boundary instead of repeated local branches
- [ ] tests state the intended fallback precedence directly

Verification:

- [ ] relevant unit tests pass
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run ops:smoke` after deploy if route or runner behavior changes

### P1. Extend Feature-Scoped Provider Contracts Beyond Summary

Why second:

- the summary slice already proved the pattern is manageable
- feature-scoped tightening improves DX without committing to a repo-wide type campaign
- this reduces accidental use of embedding-only or unknown providers in LLM-only paths

Primary scope:

- [src/lib/chat/translation-service.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-service.ts)
- [src/app/api/messages/reprocess/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/messages/reprocess/route.ts)
- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- supporting feature-local contracts under [src/lib/chat](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat)

Entry checklist:

- [ ] choose whether the next slice should start with `translation`, `reprocess`, or `chat`
- [ ] confirm where raw provider strings still need to remain allowed at the DB boundary
- [ ] identify tests that should fail if an embedding-only provider reaches an LLM-only flow

Implementation checklist:

- [ ] tighten feature-local contracts to `LlmProvider` or another narrower local type where appropriate
- [ ] keep runtime narrowing close to request or DB ingress points
- [ ] avoid rewriting unrelated `llm/*` infrastructure unless the feature cannot be completed otherwise

Done when:

- [ ] at least one more non-summary LLM feature uses explicit LLM-only provider contracts
- [ ] compile-time signals catch more provider drift before runtime
- [ ] the change stays feature-scoped rather than turning into a global refactor

Verification:

- [ ] relevant unit tests pass
- [ ] `npm run typecheck`

### P2. Trim Remaining Chat-Screen API Key DTO Duplication

Why last:

- this is useful DX cleanup, but lower impact than canonical model-resolution work
- the remaining duplication is mostly UI-facing and less likely to create runtime bugs

Primary scope:

- [src/app/dashboard/chats/new/NewChatForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/NewChatForm.tsx)
- [src/app/dashboard/chats/new/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/page.tsx)
- [src/app/dashboard/chats/[id]/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/page.tsx)
- [src/app/dashboard/chats/[id]/utils/types.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/types.ts)

Entry checklist:

- [ ] confirm the minimal shared shape actually used by chat-screen API key selectors
- [ ] decide whether the shared type belongs next to the chat feature or in an existing account/chat-options contract file

Implementation checklist:

- [ ] extract one shared chat-facing API key option type if at least two callers need the same exact shape
- [ ] remove repeated projection and label-formatting logic where it is materially duplicated
- [ ] keep view-only fields local if they do not improve real reuse

Done when:

- [ ] changing the chat-screen API key option shape touches one shared definition instead of several local copies
- [ ] the extraction stays local to the chat-facing selector use case

Verification:

- [ ] relevant unit tests pass
- [ ] `npm run typecheck`

## Stop Conditions

Pause before continuing to the next item if any of these become true:

- the work starts turning into repo-wide `string` cleanup instead of fixing a concrete drift boundary
- a shared resolver would need several mode flags just to preserve unrelated feature behavior
- the next slice would mainly centralize UI types without reducing real contract duplication
- a production bug, schema contract change, or deployment issue becomes higher priority

## Current Recommendation

As of 2026-04-19:

- start with `P0 Canonicalize LLM Config Resolution`
- do not start with repo-wide `provider: string` replacement
- keep experimental memory invalidation rules out of this backlog unless the product contract changes

## Follow-Up Notes

- If `P0` exposes genuinely different semantics between `chat`, `translation`, `reprocess`, and `summary`, write a short design note before forcing them into one abstraction.
- If additional SSoT/DRY cleanup is discovered later, add it here only when it is a bounded execution slice with clear drift risk and clear ownership.
