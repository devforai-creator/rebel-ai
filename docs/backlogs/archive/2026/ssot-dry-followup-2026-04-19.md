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

Status: completed locally on 2026-04-19

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

- [x] define the exact canonical output shape for resolved LLM config
- [x] decide which callers need `provider + modelName` only and which also need `serviceTier` or `apiKeyId`
- [x] identify current fallback precedence differences that must remain intentional versus ones that should converge

Implementation checklist:

- [x] extract one narrow shared resolver for active LLM config selection
- [x] make summary, translation, reprocess, and chat-send paths use that resolver or an explicit wrapper around it
- [x] remove duplicated default-model fallback logic where the resolver becomes canonical
- [x] keep embedding-only providers rejected at the canonical boundary rather than at scattered call sites

Done when:

- [x] changing provider fallback rules no longer requires editing several feature paths
- [x] model selection semantics are described by one shared boundary instead of repeated local branches
- [x] tests state the intended fallback precedence directly

Verification:

- [x] relevant unit tests pass
- [x] `npm run typecheck`
- [x] `npm run lint`
- [ ] `npm run ops:smoke` after deploy if route or runner behavior changes

### P1. Close Queue/Runtime LLM-Only Provider Contracts

Status: completed locally on 2026-04-19

Why second:

- the remaining high-risk gap after `P0` was no longer route selection, but the queue/runtime contract
- chat send paths were already narrowed at the ingress boundary, but the serialized job payload still
  allowed non-LLM providers to be represented
- this is the point where an accidental embedding-only provider could survive until deep runner logic

Primary scope:

- [src/lib/chat/job-payload.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/job-payload.ts)
- [src/lib/llm/model-factory.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/llm/model-factory.ts)
- [src/app/api/internal/chat-job-runner/provider-request-stage.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/provider-request-stage.ts)
- [src/app/api/internal/chat-job-runner/streaming-response-stage.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/streaming-response-stage.ts)
- supporting runner helpers under [src/app/api/internal/chat-job-runner](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner)

Entry checklist:

- [x] confirm that raw DB rows can remain permissive while job payloads and runner contracts should not
- [x] identify the smallest end-to-end slice where `voyage_embeddings` was still representable
- [x] identify tests that should fail if an embedding-only provider reaches an LLM-only flow

Implementation checklist:

- [x] narrow `ChatGenerationJobPayload.provider` to `LlmProvider`
- [x] reject embedding-only providers during payload parsing instead of later runner stages
- [x] propagate the narrower provider contract through runner helpers that directly consume payload provider
- [x] narrow `buildLanguageModel` so the final LLM construction boundary also rejects illegal provider values

Done when:

- [x] embedding-only providers are no longer representable in serialized chat job payloads
- [x] compile-time signals catch more provider drift before runtime execution
- [x] the change stays bounded to queue/runtime LLM execution rather than turning into a repo-wide cleanup

Verification:

- [x] relevant unit tests pass
- [x] `npm run typecheck`
- [x] `npm run lint`
- [ ] `npm run ops:smoke` after deploy because runner behavior changed

### P2. Trim Remaining Chat-Screen API Key DTO Duplication

Status: completed locally on 2026-04-19

Why last:

- this is useful DX cleanup, but lower impact than canonical model-resolution work
- the remaining duplication is mostly UI-facing and less likely to create runtime bugs

Primary scope:

- [src/app/dashboard/chats/new/NewChatForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/NewChatForm.tsx)
- [src/app/dashboard/chats/new/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/page.tsx)
- [src/app/dashboard/chats/[id]/page.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/page.tsx)
- [src/app/dashboard/chats/[id]/utils/types.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/types.ts)

Entry checklist:

- [x] confirm the minimal shared shape actually used by chat-screen API key selectors
- [x] decide whether the shared type belongs next to the chat feature or in an existing account/chat-options contract file

Implementation checklist:

- [x] extract one shared chat-facing API key option type if at least two callers need the same exact shape
- [x] remove repeated projection and label-formatting logic where it is materially duplicated
- [x] keep view-only fields local if they do not improve real reuse

Done when:

- [x] changing the chat-screen API key option shape touches one shared definition instead of several local copies
- [x] the extraction stays local to the chat-facing selector use case

Verification:

- [x] relevant unit tests pass
- [x] `npm run typecheck`

## Stop Conditions

Pause before continuing to the next item if any of these become true:

- the work starts turning into repo-wide `string` cleanup instead of fixing a concrete drift boundary
- a shared resolver would need several mode flags just to preserve unrelated feature behavior
- the next slice would mainly centralize UI types without reducing real contract duplication
- a production bug, schema contract change, or deployment issue becomes higher priority

## Current Recommendation

As of 2026-04-19:

- `P0 Canonicalize LLM Config Resolution` is completed locally
- `P1 Close Queue/Runtime LLM-Only Provider Contracts` is completed locally
- `P2 Trim Remaining Chat-Screen API Key DTO Duplication` is completed locally
- there is no remaining must-do item from this backlog
- only continue if a new bounded slice with clear drift risk appears
- do not start with repo-wide `provider: string` replacement
- keep experimental memory invalidation rules out of this backlog unless the product contract changes

## Follow-Up Notes

- If `P0` exposes genuinely different semantics between `chat`, `translation`, `reprocess`, and `summary`, write a short design note before forcing them into one abstraction.
- If additional SSoT/DRY cleanup is discovered later, add it here only when it is a bounded execution slice with clear drift risk and clear ownership.
