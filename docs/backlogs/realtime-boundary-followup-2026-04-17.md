# Realtime Boundary Follow-Up

Updated: 2026-04-17

This backlog records the remaining auth-session hardening work after `P0-2` and `P0-3`.

Current status:

- browser-authenticated create-chat flow: removed
- browser-authenticated import upload admission: removed
- browser-authenticated realtime: still present

Remaining runtime call sites:

- [src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)

This document is intentionally deferred work. It should not be treated as an immediate execution queue unless a trigger from
[docs/realtime-boundary-checklist.md](../realtime-boundary-checklist.md) has fired.

## Phase 1. Design Spike

Goal:

- choose the steady-state realtime boundary before implementation starts

Done when:

- one option is selected:
  - temporary exception
  - short-lived scoped realtime credentials
  - app-server fan-out
- the selected option has a rollback plan
- latency and operations tradeoffs are written down

## Phase 2. Thin Slice Prototype

Goal:

- prove the chosen transport can preserve acceptable chat UX

Done when:

- one realtime path is prototyped first
- reconnect behavior is tested explicitly
- message delivery semantics are documented

## Phase 3. Production Rollout

Goal:

- move the remaining browser auth realtime exception set to the chosen boundary

Done when:

- browser runtime allowlist is updated
- relevant tests cover the new transport assumptions
- production verification confirms no material chat UX regression

## Parked Risks

These are the reasons this backlog still exists:

- current realtime hooks still call `supabase.auth.getSession()` in the browser before subscribing
- the app cannot fully claim an `HttpOnly`-capable primary session boundary while those hooks remain
- XSS blast radius is reduced compared with the original state, but not fully minimized yet

## Recommendation

Do not schedule this as background cleanup.

Schedule it when:

- chat realtime work is already happening anyway, or
- security/compliance pressure makes the remaining browser realtime exception no longer acceptable
