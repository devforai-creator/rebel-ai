# Auth Session Hardening Backlog

Updated: 2026-04-16

This document is the execution backlog for phased reduction of RebelAI's browser-readable auth
session surface.

It is not:

- a full repo security backlog
- a broad auth rewrite plan
- a substitute for the architecture note in
  [docs/auth-session-hardening-architecture.md](../auth-session-hardening-architecture.md)

Use this backlog to sequence bounded work sessions against the current confirmed gap.

## Working Rules

- Do not turn this backlog into a full security review sweep.
- Prefer changes that reduce recurring browser auth surface over one-off cleanup.
- Keep performance-sensitive paths explicit; do not accidentally proxy large binary uploads through
  the app server.
- Every behavior change lands with regression coverage in the same change.
- Realtime work does not block CRUD or upload hardening unless the implementation path truly
  requires it.
- New browser-authenticated Supabase runtime usage does not enter the repo without explicit
  allowlist discussion.

## Current Baseline

Already true:

- most authenticated route handlers and server actions already use server-owned auth checks and
  ownership scoping
- the remaining browser-authenticated Supabase runtime surface is concentrated in a small set of
  files
- the current chat renderer and CSP posture already provide some defense in depth, even though that
  is not a substitute for reducing session exposure

Still open in practice:

- browser-authenticated chat creation
- browser-authenticated import upload admission
- browser-authenticated realtime for chat and summaries
- no mechanical guard that freezes the current browser auth client exception set

Representative current runtime call sites:

- [src/app/dashboard/chats/new/NewChatForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/NewChatForm.tsx)
- [src/app/dashboard/characters/CharacterImport.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterImport.tsx)
- [src/app/dashboard/characters/character-ui-logic.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/character-ui-logic.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)

## P0

### P0-1. Freeze Browser Auth Client Growth

Scope:

- [src/lib/supabase/client.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/supabase/client.ts)
- a repo-level guard or targeted test that enforces an allowlist for runtime imports
- the docs added in this session

Why:

- the current browser auth client surface is still small enough to unwind
- if new runtime call sites keep appearing, later session-boundary hardening gets more expensive

Done when:

- the current runtime exception set is explicit
- CI or a targeted test fails when a new non-allowlisted runtime import of
  `@/lib/supabase/client` appears
- the allowlist is documented so future changes are conscious, not accidental

Current evidence as of `2026-04-16`:

- current runtime imports are concentrated in five files rather than spread across the repo
- there is no mechanical guard preventing more browser-authenticated runtime usage from landing

### P0-2. Move New Chat Creation Off Browser Supabase CRUD

Scope:

- [src/app/dashboard/chats/new/NewChatForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/NewChatForm.tsx)
- related chat creation helpers under
  [src/app/dashboard/chats/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/actions.ts) or a new bounded action/route
- chat creation tests

Why:

- create-chat is a low-frequency mutation and does not need broad browser-authenticated DB access
- this is the highest-value low-disruption place to reduce browser auth surface first

Done when:

- the browser path no longer calls `supabase.auth.getUser()` for chat creation
- the browser path no longer performs direct `.from('chats')` or `.from('messages')` writes for
  initial chat creation
- initial greeting behavior remains correct
- tests cover unauthenticated, success, and failure branches

Current evidence as of `2026-04-16`:

- [src/app/dashboard/chats/new/NewChatForm.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/new/NewChatForm.tsx)
  still creates a browser Supabase client and writes `chats` and `messages` directly

### P0-3. Replace Browser Storage Upload Admission With A Server-Issued Upload Contract

Scope:

- [src/app/dashboard/characters/CharacterImport.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/CharacterImport.tsx)
- [src/app/dashboard/characters/character-ui-logic.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/character-ui-logic.ts)
- [src/app/api/characters/import/storage/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/characters/import/storage/route.ts)
- import tests and operator docs as needed

Why:

- current import admission still depends on a broad browser-authenticated storage client
- large upload throughput should remain browser-to-storage, but the server should own the admission
  contract

Done when:

- the browser obtains an upload contract from the server first
- the file transfer remains direct to storage rather than proxied through the app server
- the job-enqueue path accepts only server-verifiable upload references
- tests cover invalid upload reference, unauthorized upload admission, and happy path behavior

Current evidence as of `2026-04-16`:

- [src/app/dashboard/characters/character-ui-logic.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/character-ui-logic.ts)
  still performs `supabase.auth.getUser()` and direct storage upload in the browser before job
  enqueue

## P1

### P1-1. Choose The Realtime Boundary Deliberately

Scope:

- [src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)
- any follow-up transport or server fan-out design note

Why:

- realtime is the main remaining browser-authenticated exception after CRUD and upload hardening
- it has different latency and complexity tradeoffs than ordinary mutations

Done when:

- the repo has an explicit recorded choice between temporary exception, server fan-out, or
  short-lived scoped realtime credentials
- the choice includes latency, complexity, and operational tradeoffs
- the final session-boundary cutover is no longer blocked by an undefined realtime plan

Current evidence as of `2026-04-16`:

- both runtime hooks still create browser Supabase clients and call `auth.getSession()` before
  subscribing

### P1-2. Cut Over The Primary Session Boundary

Scope:

- [src/app/auth/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/auth/actions.ts)
- [src/lib/supabase/server.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/supabase/server.ts)
- [src/middleware.ts](/home/tmdduq96kr/projects/rebel-ai/src/middleware.ts)
- any runtime paths still intentionally using browser auth after the earlier phases

Why:

- until the primary session becomes server-owned or `HttpOnly`-capable, XSS blast radius remains
  larger than desired
- earlier backlog items are meant to make this cutover bounded rather than sprawling

Done when:

- browser direct CRUD and upload admission no longer depend on a broad browser-authenticated
  session
- the primary session boundary is moved to an `HttpOnly`-capable model
- any remaining browser exception set is explicit and narrow
- the final contract is documented in operator-facing docs if deployment expectations change

Current evidence as of `2026-04-16`:

- the repo still relies on a browser Supabase auth client for the runtime paths listed above

## P2

### P2-1. Revisit Defense-In-Depth Once The Boundary Shrink Lands

Scope:

- targeted security guards and docs after the main browser auth surface has been reduced

Why:

- some later hardening work will only be worth doing once the higher-leverage boundary reduction is
  complete

Done when:

- follow-up hardening tasks are prioritized against the reduced browser auth surface rather than the
  pre-hardening baseline

This item is intentionally parked until the earlier phases land.
