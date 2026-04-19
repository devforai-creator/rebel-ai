# Chat Boundary Cleanup Checklist

Updated: 2026-04-19

This note turns the current chat-architecture discussion into an execution checklist.

It is not a whole-chat rewrite plan.
It is the minimum structured plan for reducing the current chat-boundary complexity without paying for a full redesign.

Use this document before starting implementation on the three agreed cleanup areas:

1. persona write-path convergence
2. chat send/regeneration API contract tightening
3. chat detail shell boundary split

## Goals

- keep one clear write path per domain action
- move chat runtime closer to `DB as source of truth`
- reduce the blast radius of the chat detail route
- sequence the work so later cleanup does not invalidate earlier work

## Non-Goals

- full chat architecture rewrite
- replacing Supabase realtime transport
- redesigning the product UX
- rewriting the whole chat page in one pass

## Working Rules

- Do the work in order unless a later slice is fully independent in write scope and contract.
- Every behavior change must land with regression coverage in the same change.
- If phase 2 changes the public chat request contract, update the relevant docs in the same change.
- Do not start phase 3 by moving files around blindly; split along state ownership and behavior seams.
- If a phase changes internal routes, queue runner behavior, or deployment assumptions, run `npm run ops:smoke` after deploy before closing the task.

## Recommended Order

### Phase 1. Converge Persona Write Paths

Status: not started

Why first:

- lowest-risk cleanup
- creates the `one action -> one server write path` rule we want to keep elsewhere
- reduces drift before touching the chat runtime contract

Primary scope:

- [src/app/dashboard/chats/[id]/ChatPersonaWidget.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatPersonaWidget.tsx)
- [src/app/api/personas/[personaId]/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/personas/[personaId]/route.ts)
- [src/app/dashboard/personas/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/personas/actions.ts)

Entry checklist:

- [ ] choose the canonical server-side persona update path
- [ ] confirm whether chat-screen persona editing should use server actions, route handlers, or a shared service function
- [ ] identify current validation and ownership checks that must remain identical after convergence

Implementation checklist:

- [ ] move shared persona update rules into one canonical server-side function
- [ ] make both the dashboard persona manager and chat persona editor call that same logic
- [ ] remove duplicated validation and ownership checks where practical
- [ ] keep response semantics predictable for the caller that remains

Done when:

- [ ] persona update validation exists in one canonical place
- [ ] persona ownership enforcement exists in one canonical place
- [ ] chat persona editing and persona management no longer risk contract drift
- [ ] regression tests cover success, unauthorized access, and invalid payload behavior

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

### Phase 2. Tighten Chat Send and Regeneration Contracts

Status: not started

Why second:

- this is the highest-value structural fix
- it reduces trust in client-built transcript state
- phase 3 should happen after this so UI boundaries form around the steadier contract

Primary scope:

- [src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts)
- [src/app/dashboard/chats/[id]/hooks/queued-chat-api.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/queued-chat-api.ts)
- [src/app/dashboard/chats/[id]/utils/types.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/types.ts)
- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- [src/app/api/internal/chat-job-runner/execution-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.ts)
- [docs/chat-regeneration-architecture.md](/home/tmdduq96kr/projects/rebel-ai/docs/chat-regeneration-architecture.md)

Entry checklist:

- [ ] decide the desired request contract for normal send
- [ ] decide the desired request contract for regeneration
- [ ] confirm what temporary compatibility layer, if any, is needed for `messages` payload support
- [ ] identify the exact tests that currently lock in client-transcript behavior

Implementation checklist:

- [ ] define a slimmer request shape for normal send, centered on `chatId`, `apiKeyId`, and the new user input
- [ ] define a slimmer request shape for regeneration, centered on `chatId`, `apiKeyId`, and the target assistant message id
- [ ] stop requiring the client to build full transcript state for the supported core path
- [ ] keep the runner responsible for reconstructing generation context from DB-backed state
- [ ] preserve current queue, rate-limit, and active-job admission behavior
- [ ] update docs to match the new supported request contract

Done when:

- [ ] the supported chat API no longer depends on a full client-built transcript for normal send
- [ ] regeneration no longer relies on client transcript state as the authoritative context source
- [ ] tests state clearly when payload transcript is allowed as an optimization and when it is not
- [ ] route tests and runner tests cover the updated contract directly
- [ ] docs describe the new steady-state contract instead of the old compatibility shape

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`
- [ ] `npm run ops:smoke` after deploy

### Phase 3. Split the Chat Detail Shell by State Ownership

Status: not started

Why third:

- the shell split is easier once the chat request contract is steadier
- otherwise the UI will likely be split around behavior that changes again immediately after phase 2

Primary scope:

- [src/app/dashboard/chats/[id]/ChatInterface.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx)
- [src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatMessageActions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatMessageActions.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatRuntimeVariables.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRuntimeVariables.ts)
- related chat detail components and tests under [src/app/dashboard/chats/[id]](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id])

Entry checklist:

- [ ] identify current state owners inside `ChatInterface`
- [ ] choose the target seams before moving code
- [ ] confirm which refs and mutable maps still need to stay together

Preferred seams:

- chat settings and model-selection state
- message lifecycle and queue state
- realtime subscription integration
- runtime variables and asset-driven UI state
- debug and diagnostics surfaces

Implementation checklist:

- [ ] keep `ChatInterface` as an orchestration layer, not the default home for new behavior
- [ ] move message lifecycle concerns behind a tighter boundary than the current mixed hook surface
- [ ] separate asset/runtime-variable behavior from queue/message behavior
- [ ] reduce cross-hook hidden coupling where possible
- [ ] add or extend tests around the extracted boundaries instead of relying on one large integration surface

Done when:

- [ ] `ChatInterface` is materially smaller and more orchestration-focused
- [ ] message lifecycle, settings, and runtime-variable behavior have clearer ownership boundaries
- [ ] future chat work no longer defaults to editing the same large route shell file
- [ ] the extracted seams have explicit test coverage

Verification:

- [ ] relevant unit tests pass
- [ ] `npx tsc --noEmit`

## Stop Conditions

Pause and reassess before starting the next phase if any of these become true:

- the previous phase changed the public or internal contract more than expected
- new regressions appear in chat send, regeneration, or message reconciliation
- production behavior suggests the real bottleneck is elsewhere
- the next phase would require cross-cutting schema changes not captured here

## Current Recommendation

As of 2026-04-19:

- start with phase 1, not phase 2
- treat phase 2 as the main structural change
- start phase 3 only after phase 2 lands or the phase 2 contract is explicitly deferred
