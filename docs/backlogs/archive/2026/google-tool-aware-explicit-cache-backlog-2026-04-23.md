# Google Tool-Aware Explicit Cache Backlog

Updated: 2026-04-23
Status: Archived

Reactivation note:

- drafted on `2026-04-23` immediately after the Google cache boundary cleanup
- intentionally parked until
  [`llm-invocation-ownership-backlog-2026-04-23.md`](./llm-invocation-ownership-backlog-2026-04-23.md)
  clarified which invocation routes should share common config/decrypt/model
  setup and which should remain intentionally separate
- reactivated on `2026-04-23` after that queue closed with full verification
- the boundary contract from `GOOGLE_CACHE_BOUNDARY.md` still stands; this queue
  still exists on sequencing grounds, not because tool-aware explicit cache stopped
  mattering

Close-out note:

- deployed on `2026-04-23`
- `npm run ops:smoke:active` returned `summary=warn`, but the failing signal was
  internal triage `503` with `recentFailedJobCount=4`; health, signup, storage
  janitor dry-run, chat runner active probe, and character import runner active
  probe all passed
- live post-deploy validation showed both normal cached Google turns and
  tool-capable cached Google turns succeeding with `cacheCreated: true`,
  `cachedInputTokens > 0`, and `compatibilityRetryAttempted: false`
- this queue closes because the Google cached tool-turn path is now proven on the
  active deployment; the triage warning remains an ops signal, not a blocker for
  this queue

This document is the execution backlog for adding Google explicit-cache support
to tool-capable turns without breaking the Google cache boundary contract.

This queue starts after
[google-cache-boundary-backlog-2026-04-23.md](./google-cache-boundary-backlog-2026-04-23.md)
closed the boundary-cleanup work and after
[GOOGLE_CACHE_BOUNDARY.md](../../../GOOGLE_CACHE_BOUNDARY.md) established the
removable-adapter contract.

It exists to answer two narrower questions:

- how to keep tool-capable Google turns cacheable without re-entangling cache
  policy with ATR admission or runner ownership
- how to reduce or remove the current Google cache/tool compatibility retry once
  a supported cached tool path exists

It is not:

- a general Google provider rewrite
- a cache TTL or hit-rate tuning sweep
- permission for hidden retries or silent user spend
- a reason to weaken the uncached Google core path
- a mandate to make summary, translation, reprocess, or other secondary surfaces
  inherit explicit cache behavior
- a pretext for building a repo-wide cache platform before the chat runner use
  case is proven

## Working Rules

- Preserve the uncached Google path as the supported default contract.
- Keep all tool-aware cache work inside the explicit-cache adapter seam.
- Treat the queued chat runner as the only rollout target for this queue.
- Allow reusable provider-level cache primitives only when they stay below the
  chat-runner adapter seam and do not silently activate explicit cache in other
  invocation owners.
- Do not widen ATR into a general Google cache orchestrator.
- Every cached tool-turn behavior change lands with regression coverage and
  debug visibility in the same slice.
- If a provider or SDK limitation blocks a clean implementation, stop and write
  the narrower seam decision down instead of smuggling in broad fallback logic.

## Why This Queue Exists

The boundary queue intentionally stopped short of implementing tool-aware
explicit cache. That was correct for the boundary cleanup, but it leaves one
deliberate gap:

- tool-capable Google turns still pre-disable explicit cache
- the runner still carries a narrow compatibility retry for cache/tool
  conflicts

If RebelAI wants cheaper Google tool turns with explicit cache, that work now
belongs in its own bounded queue rather than in the archived boundary cleanup.

## Acceptance Bar

This queue is only successful if all of the following become true:

1. Tool-capable Google turns can intentionally use explicit cache when it is
   enabled and supported.
2. Cache creation and cached request wiring preserve the same tool contract the
   actual Google invocation needs.
3. Cache-off or cache-miss behavior still falls back to the same uncached Google
   core path without changing chat correctness.
4. The compatibility retry is either removed or reduced to a clearly temporary
   and explicitly tracked provider-compatibility shim.
5. Debug and usage surfaces make cached vs uncached tool turns observable
   without guessing from token cost.

## P0 Execution Order

### P0-1. Define The Cached Tool-Turn Request Contract

Status: `completed`

Primary scope:

- `src/lib/llm/google-cache.ts`
- `src/app/api/internal/chat-job-runner/google-explicit-cache-adapter.ts`
- adjacent Google request-shape tests

Acceptance notes:

- one canonical cached tool-turn envelope exists
- tool schema and tool config ownership are explicit at cache-create time
- cached and uncached Google request shapes stay comparable at the seam
- canonical uncached Google invocation remains the source of truth and the
  cached variant stays an adapter overlay

Evidence:

- `src/lib/llm/google-cache.ts`
- `src/lib/llm/function-tool-contract.ts`
- `src/lib/experimental/agentic-transcript-recall/tool-contract.ts`
- `src/app/api/internal/chat-job-runner/google-explicit-cache-adapter.ts`
- `src/lib/llm/google-cache.test.ts`
- `src/lib/experimental/agentic-transcript-recall/tool-contract.test.ts`
- `src/app/api/internal/chat-job-runner/google-explicit-cache-adapter.test.ts`
- `src/app/api/internal/chat-job-runner/provider-request-stage.test.ts`

### P0-2. Teach Cache Creation And Request Wiring About Tools

Status: `completed`

Primary scope:

- Google cache creation helpers
- Google cached request envelope wiring
- provider-specific request construction if the SDK seam needs it

Acceptance notes:

- tool-capable requests no longer pre-disable explicit cache by default once the
  supported cached path exists
- cache inputs include the Google tool contract required by the real provider
  call
- cache failure still degrades to the uncached path, not to a broken tool turn
- no secondary invocation owner starts using explicit cache as a side effect of
  this queue

Evidence:

- `src/lib/llm/google-cache.ts`
- `src/lib/experimental/agentic-transcript-recall/runner.ts`
- `src/app/api/internal/chat-job-runner/google-explicit-cache-adapter.ts`
- `src/app/api/internal/chat-job-runner/provider-request-stage.ts`
- `src/lib/llm/google-cache.test.ts`
- `src/lib/experimental/agentic-transcript-recall/runner.test.ts`
- `src/app/api/internal/chat-job-runner/google-explicit-cache-adapter.test.ts`
- `src/app/api/internal/chat-job-runner/provider-request-stage.test.ts`
- `src/app/api/internal/chat-job-runner/service.test.ts`

### P0-3. Prove Cached Tool-Turn Correctness And Narrow Compatibility Retry

Status: `completed`

Primary scope:

- `src/app/api/internal/chat-job-runner/service.ts`
- Google request-stage / runner regression tests
- usage/debug coverage

Acceptance notes:

- tests cover successful cached Google tool-capable turns
- tests cover safe uncached fallback when cache creation or cache use is not
  supported
- the compatibility retry is either removed or left behind a visibly temporary
  log or backlog note
- current runner behavior keeps the retry only as a temporary provider
  compatibility shim in `service.ts`, to be revisited during `P0-4`

Evidence:

- `src/app/api/internal/chat-job-runner/service.ts`
- `src/app/api/internal/chat-job-runner/service.test.ts`
- `src/app/api/internal/chat-job-runner/usage-debug.test.ts`

### P0-4. Verify Deployment Safety And Decide Queue Close-Out

Status: `completed`

Primary scope:

- full-suite verification
- deploy/ops follow-up only if needed

Acceptance notes:

- closure uses full-suite evidence, not targeted-test optimism
- any remaining compatibility shim is explicitly tracked as follow-up, not left
  as an undocumented forever path
- if deployment verification is needed after rollout, note the exact smoke-check
  requirement before archiving this queue

Execution notes:

- `2026-04-23`: `npm run verify` passed locally
- result: `206 passed | 5 skipped` test files
- result: `1797 passed | 54 skipped` tests
- `2026-04-23`: follow-up fix switched cached Google tool turns to cache-owned
  `AUTO` tool mode and stripped live `system/tools/toolConfig` at the Google
  model seam; targeted regression tests, `npx tsc --noEmit`, and
  `npm run format:check` passed locally
- close-out decision: keep this queue active until the current changes are
  deployed and `npm run ops:smoke:active` is run against the active deployment
- archive only after that deploy smoke confirms the runner/internal-route path
  remains healthy
- `2026-04-23`: `npm run ops:smoke:active` against the active deployment returned
  `summary=warn`
- smoke details: signup closed `200`, internal health `200`, storage janitor
  dry-run dispatch `202`, chat runner active probe `200`, character import runner
  active probe `200`
- smoke warning detail: internal triage `503` with
  `{"degradedServiceCount":0,"recentFailedJobCount":4}`
- `2026-04-23`: live runtime validation after deploy confirmed:
  - normal Google cached turn with `cacheCreated: true` and
    `cachedInputTokens > 0`
  - tool-capable Google cached turn with `cacheCreated: true`,
    `cachedInputTokens > 0`, `toolCallCount: 1`, `toolFetchCount: 1`, and
    `compatibilityRetryAttempted: false`
- close-out decision: archive this queue; the remaining triage warning is outside
  the Google explicit-cache/tool-contract scope

## Explicitly Parked

Do not pull these into this queue unless the contract changes:

- cache TTL tuning
- cache hit-rate heuristics
- broader provider cache unification across OpenAI / Anthropic / Google
- unrelated Google model or pricing adjustments
- ATR feature expansion unrelated to Google cache/tool compatibility
- opt-in explicit cache rollout for summary, translation, reprocess, or other
  non-chat invocation owners

## End Condition

This queue should close when Google tool-capable turns can use explicit cache
through the adapter seam, the uncached path remains the supported fallback, and
any temporary compatibility shim is either removed or explicitly tracked.
