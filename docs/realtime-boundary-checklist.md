# P1-1 Realtime Boundary Checklist

Updated: 2026-04-17

This note exists to answer one question cleanly:

`Should we resume the remaining auth-session hardening work now, or intentionally defer it?`

It is a decision checklist, not an implementation spec.

The remaining browser-authenticated session surface is currently limited to realtime:

- [src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)

Use this checklist before opening a P1-1 implementation branch.

## Resume Triggers

Resume P1-1 when one or more of these are true:

- a new feature already requires touching chat realtime transport or subscription behavior
- an external security review or customer requirement asks for a more `HttpOnly`-capable session boundary
- a new user-controlled rendering surface meaningfully increases XSS concern
- the current realtime path starts causing operational issues that would justify redesign anyway
- the team is ready to spend focused time on transport design, rollback planning, and production verification

If none of those are true, deferring is acceptable.

## Do Not Start Yet If

Do not start P1-1 yet if any of these are true:

- the recent `P0-2` and `P0-3` changes have not been stable in production long enough to trust
- there is no clear owner for both implementation and rollback
- current chat UX, reconnect behavior, and runner load are not baselined
- the team is trying to squeeze this into unrelated feature work without time for validation

## Entry Checklist

Only start when all of the following are true:

- `P0-2` and `P0-3` are deployed and observed without meaningful regressions
- current browser auth runtime imports remain only the two realtime hooks
- the team has captured a baseline for:
  - message delivery latency
  - reconnect behavior after refresh / tab sleep / network flap
  - Vercel invocation and CPU behavior on the active deployment
- there is a chosen rollback path that can restore the current realtime model quickly
- a preferred option has been selected from the decision matrix below

## Decision Matrix

Pick one option deliberately before implementation.

### Option A. Temporary Exception

Keep Supabase realtime in the browser for now.

Choose this when:

- product work has higher priority than transport hardening
- there is no immediate external pressure to remove browser-held realtime auth
- current blast radius is considered acceptable after the `P0` reductions

Cost:

- lowest engineering cost now

Risk:

- browser session boundary remains incomplete

### Option B. Short-Lived Scoped Realtime Credentials

Keep browser realtime, but reduce the credential scope/lifetime.

Choose this when:

- the team wants a meaningful security improvement without fully owning a custom fan-out layer
- Supabase realtime remains a good fit operationally

Cost:

- medium

Risk:

- credential issuance and refresh logic add complexity

### Option C. App-Server Fan-Out

Move realtime transport behind the app server using SSE or WebSocket.

Choose this when:

- the team wants the cleanest long-term session boundary
- chat realtime behavior is important enough to justify owning the transport layer

Cost:

- highest

Risk:

- highest UX and operational regression risk if done casually

## Exit Criteria

P1-1 is done only when all of these are true:

- the chosen realtime boundary is documented
- the rollout path and rollback path are documented
- the browser auth runtime allowlist is updated to match the new steady state
- production verification confirms chat UX is still acceptable

## Current Recommendation

As of 2026-04-17:

- deferring implementation is reasonable
- a short design spike is the next sensible step, not immediate transport work
- the right trigger is likely `the next substantial chat/realtime change`, not an arbitrary calendar date
