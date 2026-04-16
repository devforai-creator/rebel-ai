# Auth Session Hardening Architecture

Updated: 2026-04-17

This document records the recommended architecture for reducing RebelAI's dependence on a
browser-readable authenticated session.

The main decision is to treat this as a phased boundary-hardening project, not as a one-pass auth
rewrite.

## Goals

- Reduce the blast radius of future XSS by shrinking the browser-held auth/session surface.
- Stop expanding browser-side authenticated Supabase usage as new features land.
- Move low-frequency CRUD flows onto server-owned boundaries first.
- Keep the first-class chat and import UX responsive while hardening the boundary.
- Create a clear path toward an `HttpOnly`-capable session model later.

## Non-Goals

- Replacing Supabase Auth entirely.
- Rewriting every dashboard data-loading path in one pass.
- Removing client-side realtime in the first phase.
- Proxying large RBX uploads through the app server in the first phase.
- Treating this document as a full repo security audit.

## Current State

Most authenticated route handlers and server actions already rely on server-side auth checks and
ownership scoping. The remaining browser-authenticated Supabase usage is concentrated in a small
set of runtime paths:

- [src/app/dashboard/characters/CharacterImport.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterImport.tsx)
- [src/app/dashboard/characters/character-ui-logic.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/character-ui-logic.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)

In practice, those paths mean:

- import admission still performs authenticated browser-side storage upload
- chat and summary updates still depend on client-side realtime subscriptions
- new chat creation has already moved behind a server action, reducing one browser-authenticated
  write path

The current gap is not "auth is missing." The gap is that the browser still owns a reusable
authenticated session for those paths, so a future XSS bug would have a larger blast radius than
desired.

## Problem

There are four structural constraints.

### 1. Browser-owned auth still exists on meaningful write paths

Import admission still uses a browser-side authenticated Supabase client for real work, not just
passive rendering. Realtime remains a separate browser-authenticated exception.

### 2. `HttpOnly` cutover is blocked by those browser flows

As long as the browser must read and use the auth session directly for CRUD, storage admission, or
realtime bootstrap, the repo cannot simply flip to an `HttpOnly` session boundary.

### 3. Not all browser flows have the same performance profile

Low-frequency mutations such as "create chat" can tolerate an extra app-server hop.

Large binary uploads should not be forced through the app server if avoidable.

Realtime should be treated separately from CRUD and upload admission because its latency and
connection model are different.

### 4. This should not become a one-pass auth rewrite

The repo already has a strong amount of server-owned auth. The right move is to reduce the
remaining browser-authenticated surface in phases instead of mixing this with a full platform auth
rework.

## Decision

Adopt a phased `boundary reduction` strategy.

High-level rule:

- Stop adding new browser-authenticated Supabase runtime paths.
- Move direct browser CRUD to server actions or authenticated route handlers first.
- Keep large-file transfer browser-to-storage when possible, but make the server issue the upload
  contract.
- Treat realtime as a separate design track instead of blocking the earlier phases on it.
- Move the primary session boundary to an `HttpOnly`-capable model only after the browser no longer
  needs broad persistent session access.

## Design Principles

- Browser-side authenticated DB writes should be rare and explicitly justified.
- Large binary transfer should stay direct when possible; do not blindly proxy through the app
  server.
- Realtime should remain fast until a replacement is designed and benchmarked.
- Security hardening should not silently redefine the first-class chat/import UX.
- This project should land as a series of bounded slices, not as a single "security rewrite."

## Recommended Phases

### Phase 0. Freeze the browser auth surface

Before changing behavior, make the current exception set explicit.

- document the current runtime imports of `@/lib/supabase/client`
- add a mechanical guard so new runtime call sites do not appear silently
- treat browser auth client usage as an allowlist, not as a normal default

This phase should not change product behavior.

### Phase 1. Move low-frequency CRUD off the browser auth client

Start with flows that have clear server-owned alternatives and low performance sensitivity.

Completed:

- [src/app/dashboard/chats/new/NewChatForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/NewChatForm.tsx)
  now calls a server action for `chats` and initial greeting `messages` creation
- browser direct `supabase.auth.getUser()` and direct `.from('chats')` / `.from('messages')`
  writes have been removed from that flow

Expected performance impact:

- one additional app-server hop for a low-frequency mutation
- acceptable for chat creation because it is not a hot rendering loop

### Phase 2. Move import admission to a server-issued upload contract

Current import admission still depends on browser auth to upload directly to storage.

Immediate targets:

- [src/app/dashboard/characters/CharacterImport.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterImport.tsx)
- [src/app/dashboard/characters/character-ui-logic.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/character-ui-logic.ts)

Recommended direction:

- browser requests an authenticated upload contract from the server
- server returns a constrained upload path or signed upload URL
- browser uploads directly to storage using that server-issued contract
- browser then calls the existing job-enqueue path with a server-verifiable upload reference

Expected performance impact:

- near-neutral for large uploads if transfer remains browser-to-storage
- avoid app-server binary proxy in the first pass

### Phase 3. Decide the realtime boundary separately

Current browser-authenticated realtime paths are:

- [src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)

The repo should explicitly choose between:

- keeping browser Supabase realtime as a temporary exception
- replacing it with app-server fan-out such as SSE or WebSocket
- issuing short-lived scoped realtime credentials from the server while keeping the primary
  session boundary server-owned

Decision rule:

- do not block phases 1 and 2 on this choice
- document the latency, complexity, and operational tradeoffs before choosing the final path

### Phase 4. Cut over the primary session boundary

Once CRUD and upload admission no longer require broad browser-authenticated Supabase access, move
the primary session boundary to an `HttpOnly`-capable model.

This document intentionally separates the target boundary from the exact transport details. The
later implementation may still use Supabase Auth, but the browser should no longer depend on
persistent direct access to the primary session for ordinary mutations.

## Performance Constraints

These are not optional nice-to-haves. They are part of the design contract.

- Do not proxy large RBX binaries through the app server in the first pass.
- Preserve current chat-page responsiveness while realtime remains on the current path.
- Prefer server-issued upload contracts or short-lived scoped credentials over generic proxying.
- Accept an additional app-server hop for low-frequency mutations such as chat creation.
- Do not ship a security hardening step that silently regresses first-class chat or import UX.

## Success Criteria

- No new runtime browser auth client call sites appear without explicit review.
- New chat creation no longer performs authenticated browser-side DB writes.
- Import admission no longer depends on a broad browser-authenticated storage client.
- The realtime exception set, if any, is explicit and intentional.
- A later `HttpOnly`-capable session cutover becomes possible without a large hidden rewrite.

## Open Questions

- Which final realtime pattern offers the best balance of latency, implementation cost, and
  operational simplicity for the first-class mode?
- Should import admission use signed upload URLs, one-time upload tickets, or another constrained
  server-issued contract?
- Should the "create chat" move land as a server action, a route handler, or an existing shared
  action path under the dashboard chat surface?

## Why This Is Worth Doing

This is not best treated as an emergency "current exploit" patch.

It is better treated as a structural hardening project that adds an important missing security
boundary while the remaining browser-authenticated surface is still small enough to unwind
deliberately.
