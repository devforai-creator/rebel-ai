# Google Cache Boundary Backlog

Updated: 2026-04-23
Status: Active

This is the current execution backlog for separating the supported Google
chat/tool invocation path from Google explicit context caching.

This queue starts from the contract in
[GOOGLE_CACHE_BOUNDARY.md](../../GOOGLE_CACHE_BOUNDARY.md).

It exists to answer two narrower questions:

- how to make Google chat and Google ATR remain fully valid when explicit cache
  is disabled
- how to narrow explicit cache into a removable optimization seam before any
  future tool-aware cache work

It is not:

- a general Google provider rewrite
- a prompt-cost optimization sweep
- a hidden-retry or silent-spend project
- the implementation queue for tool-aware explicit cache itself

## Working Rules

- Protect the no-cache Google path first.
- Keep cache policy outside ATR admission and tool policy.
- Prefer one supported uncached core invocation shape over multiple Google
  strategy branches.
- Every behavior change in this queue lands with regression coverage in the
  same change.
- If a later tool-aware explicit-cache design is still wanted, open a new
  smaller queue after this boundary closes.

## Why This Queue Exists

Google explicit cache currently leaks into maintained runtime ownership:

- request-stage logic pre-disables cache for tool-capable ATR turns
- payload planning exposes a separate `google-explicit-cache` strategy
- the runner carries a cache/tool compatibility retry path

That is workable as a compatibility patch, but it is the wrong long-term
boundary if explicit cache is supposed to be removable or optional.

The next useful step is not more Google cache cleverness.
It is a cleaner contract:

- one supported Google invocation path that works without cache
- one optional cache adapter around that path

## Acceptance Bar

This queue is only successful if all of the following become true:

1. `GOOGLE_EXPLICIT_CACHE_MODE=off` still supports normal Google chat
   generation.
2. `GOOGLE_EXPLICIT_CACHE_MODE=off` still supports Google ATR tool-capable
   turns.
3. The base Google invocation path no longer depends on cache-specific request
   planning.
4. Explicit cache can be skipped without changing the Google tool contract.
5. Any remaining Google cache compatibility logic is isolated to the cache seam
   rather than spread across ATR and runner ownership.

## P0 Execution Order

### P0-1. Define The Uncached Google Core Invocation Seam

Status: `pending`

Primary scope:

- `src/app/api/internal/chat-job-runner/provider-request-stage.ts`
- `src/app/api/internal/chat-job-runner/stream-payload-builder.ts`
- adjacent Google request-stage tests

Acceptance notes:

- one supported Google core request shape exists without `cachedContent`
- Google system/messages/tools ownership stays valid with explicit cache off
- cache-specific planning no longer defines the base Google path

### P0-2. Isolate Explicit Cache As An Adapter

Status: `pending`

Primary scope:

- `src/lib/llm/google-cache.ts`
- Google request planning helpers
- any Google-specific cache decision plumbing

Acceptance notes:

- cache eligibility, cache creation, and cache envelope wiring live behind one
  narrow seam
- the adapter can return either cached or uncached invocation data
- tool-capable requests do not require ATR-specific cache branching to stay
  safe

### P0-3. Prove Off-Mode Correctness For Google And ATR

Status: `pending`

Primary scope:

- request-stage and runner regression tests
- Google ATR integration coverage

Acceptance notes:

- tests cover normal Google chat with cache off
- tests cover Google ATR/tool-capable turns with cache off
- any fallback behavior is expressed as uncached correctness, not as cache-led
  orchestration

### P0-4. Decide The Post-Boundary Follow-Up

Status: `pending`

Primary scope:

- queue close-out
- follow-up scoping only if needed

Acceptance notes:

- if the boundary is clean, close this queue
- if tool-aware explicit cache is still wanted, open a separate bounded queue
- do not smuggle tool-aware cache implementation into this backlog by default

## Explicitly Parked

Do not pull these into this queue unless the boundary contract changes:

- cache TTL tuning
- cache hit-rate heuristics
- Google pricing-model adjustments
- broader provider cache unification across OpenAI / Anthropic / Google
- tool-aware explicit cache implementation details

## End Condition

This queue should close when the uncached Google path is clearly primary and
explicit cache is reduced to an optional adapter seam.
