# Project Scaling Hardening

This document is an engineering note for keeping RebelAI maintainable as product scope, runtime complexity, contributor surface area, and automation usage grow.

The primary goal is not "optimize the repo for weak models."
The primary goal is to keep the project scalable:

- routine changes should stay bounded
- wrong changes should stay local instead of leaking across the system
- boundary mistakes should fail fast in checks, tests, or runtime guards
- experimental work should be easy to disable without damaging the supported path
- the maintained first-class path should remain obvious as the repo grows

AI-assisted development benefits from this, but it is not the main reason to do it.
Human maintainers, future collaborators, and stronger frontier models all benefit from the same constraints.

For the stable support doctrine, see [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md).
For the current first-class operating contract, see [OPERATING_PLAN.md](./OPERATING_PLAN.md).

## 1. What This Document Is Protecting

RebelAI is already large enough that growth pressure matters more than local code style.
The main failure mode is not "bad code in one file."
The main failure mode is gradual loss of architectural clarity:

- too many modules can write durable state
- core and experimental paths blur together
- important behavior depends on unwritten maintainer knowledge
- a simple change requires understanding too much unrelated system context
- verification becomes broad, slow, and imprecise

This document is about preventing that drift.

## 2. Current Assessment

Current state: stronger than average for a solo-maintainer AI product, but not yet as scalable as it should be across every hot path.

Approximate posture:

- current: `7.5-8/10` for change resilience under growth
- realistic near-term target: `8.5-9/10` for routine feature work, refactors, and bug fixes

Why the current posture is already above average:

- support and trust boundaries are explicit in [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md)
- the active operating contract is written down in [OPERATING_PLAN.md](./OPERATING_PLAN.md)
- support tiers are represented in code in [support-tier.ts](../src/lib/support-tier.ts)
- browser/server Supabase usage already has explicit boundaries in [client.ts](../src/lib/supabase/client.ts), [server.ts](../src/lib/supabase/server.ts), and [admin.ts](../src/lib/supabase/admin.ts)
- boundary drift already has at least one dedicated static check in [check-browser-supabase-client.js](../scripts/check-browser-supabase-client.js)
- the repo has strong test density around auth, chat, queue, storage, import, and support-tier behavior

Why the score is not higher yet:

- some core chat paths still concentrate too much orchestration in a few files
- queue, runner, memory, and post-processing behavior still requires too much multi-file mental stitching
- there is not yet a single compact `verify:core` style command for the exact first-class path
- experimental and fallback behavior is conceptually separated better than it is physically separated

## 3. Main Risk Zones

These are the areas where growth pressure can most easily turn into future maintenance cost.

### 3.1 Chat request orchestration

- [src/app/api/chat/route.ts](../src/app/api/chat/route.ts)
- [src/app/api/chat/job-persistence.ts](../src/app/api/chat/job-persistence.ts)
- [src/lib/chat/turn-write.ts](../src/lib/chat/turn-write.ts)

Risk:

- request validation, rate limiting, ownership, persistence, queue admission, and experimental trigger dispatch all live close together

Desired end state:

- admission, validation, durable write, and optional side effects should each have their own narrow contract

### 3.2 Runner execution and post-generation stages

- [src/app/api/internal/chat-job-runner/service.ts](../src/app/api/internal/chat-job-runner/service.ts)
- [src/app/api/internal/chat-job-runner/execution-context.ts](../src/app/api/internal/chat-job-runner/execution-context.ts)
- [src/app/api/internal/chat-job-runner/post-generation-pipeline.ts](../src/app/api/internal/chat-job-runner/post-generation-pipeline.ts)

Risk:

- this is a high-value path where provider behavior, message state, summaries, and failure handling meet

Desired end state:

- each stage should own one transformation and expose one typed result shape

### 3.3 Dashboard chat runtime

- [src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts](../src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts)
- [src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts](../src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts)

Risk:

- client orchestration can accumulate exceptions to clean layering because it is close to user-visible behavior

Desired end state:

- UI hooks should compose service adapters and state reducers rather than embed protocol knowledge

### 3.4 Memory-mode and provider branching

- [src/lib/chat/model-config.ts](../src/lib/chat/model-config.ts)
- [src/lib/chat-memory/index.ts](../src/lib/chat-memory/index.ts)
- [src/lib/chat-summaries/index.ts](../src/lib/chat-summaries/index.ts)
- [src/lib/models/registry.ts](../src/lib/models/registry.ts)

Risk:

- future changes can accidentally widen the supported surface or make fallback behavior ambiguous

Desired end state:

- one place should decide support tier, one place should decide enablement, and one place should decide runtime dispatch

## 4. Hardening Principles

These are the rules that keep the project scalable as complexity increases.

### 4.1 Keep the required context window small

Do not require a contributor to understand auth, queueing, summaries, and rendering just to change one concern.

Prefer:

- smaller stage modules
- typed stage inputs and outputs
- one file per decision point instead of one file per broad workflow

Avoid:

- convenience refactors that merge adjacent concerns into one "orchestrator" file

### 4.2 Make the supported path the easy path

If the shortest implementation route crosses a forbidden boundary, the architecture is drifting in the wrong direction.

Prefer:

- helper entry points that already enforce ownership and support-tier rules
- one obvious factory for browser clients, one for server clients, one for admin clients
- one obvious path for first-class chat execution

### 4.3 Make boundary drift mechanically visible

Humans and tools both drift toward convenience.
Use checks to catch that drift.

Prefer:

- more static boundary scripts like [check-browser-supabase-client.js](../scripts/check-browser-supabase-client.js)
- lint rules or import-layer checks for server-only, admin-only, and experimental-only modules
- focused contract tests for route payloads and stage result shapes

### 4.4 Separate support status from implementation sprawl

`experimental` is safe only when it is isolated enough to fail without changing the supported path.

Prefer:

- non-blocking dispatch for experimental side effects
- explicit feature flags or kill switches
- physically separate modules for experimental behavior when practical

Avoid:

- synchronous coupling from supported core paths into experimental paths

### 4.5 Keep durable writes behind narrow APIs

Future maintenance cost rises sharply when too many modules can directly mutate important state.

Prefer:

- small write helpers for turns, jobs, summaries, assets, and secrets
- typed persistence helpers with stable return unions
- tests that cover conflict, permission, and partial-failure behavior

### 4.6 Keep verification short and meaningful

If the only safe way to validate a change is to run the whole repo surface every time, change velocity will decay as the project grows.

Prefer:

- a compact first-class verification command
- boundary checks that fail for architecture drift, not just syntax errors
- targeted route and pipeline tests for high-value paths

## 5. Priority Improvements

These are the highest-leverage changes for keeping RebelAI scalable and maintainable as it grows.

### Priority 1. Add a compact first-class verification command

Add one command that verifies the real maintained path instead of the full repo surface.

Target coverage:

- authenticated chat request admission
- job enqueue + runner trigger path
- runner execution service
- durable turn writes
- support-tier and boundary checks

Why it matters:

- contributors need a short, obvious verification target after every edit in the first-class path

### Priority 2. Split the chat API route by responsibility

Refactor [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) so that:

- request parsing and shape normalization live in one module
- admission and ownership checks live in one module
- turn persistence lives in one module
- queue/job dispatch lives in one module
- experimental side effects stay outside the supported synchronous path

Why it matters:

- this reduces hidden coupling in one of the most important growth-sensitive paths

### Priority 3. Turn runner stages into an explicit pipeline contract

Make the runner stages return small typed result objects with stable names and isolated side effects.

Why it matters:

- this keeps runner evolution from turning into one large mental model that only a maintainer can safely edit

### Priority 4. Add import-layer checks

Add lightweight checks for rules such as:

- browser code cannot import admin helpers
- dashboard client hooks cannot import server-only modules
- experimental modules cannot be imported from the supported synchronous core path without an explicit adapter

Why it matters:

- architectural drift often starts as import drift before it becomes logic drift

### Priority 5. Publish a first-class path map

Add one small doc or generated map that answers:

- what is the exact supported chat success path
- which modules are allowed to write durable state in that path
- which side effects are best-effort only

Why it matters:

- the project should not depend on unwritten maintainer memory to explain the main path

### Priority 6. Make experimental features disposable by default

For every experimental path, require:

- default off or de-emphasized status
- a clear kill switch
- isolation from durable-write ownership
- one test proving core success still works when the experiment fails

Why it matters:

- this is the difference between "experimental on paper" and genuinely low-risk experimentation

## 6. Review Heuristics For Future Changes

When reviewing a PR, ask these questions:

1. Did this change reduce or increase the amount of system context required to edit this area safely?
2. Did it narrow or widen the set of modules that can perform durable writes?
3. Did it make the first-class path clearer or blurrier?
4. Did it improve or weaken support-tier isolation?
5. Can a contributor verify the edited area with one obvious command?
6. If an experimental branch fails, does the supported path still succeed?

If the answers trend in the wrong direction, the change may still work functionally while making the repo less scalable and less maintainable over time.

## 7. Practical Bar

The desired bar for RebelAI is:

- routine bounded changes stay safe as the codebase grows
- core boundaries remain legible without reverse-engineering unwritten rules
- wrong edits are caught by typecheck, boundary checks, focused tests, or post-deploy smoke checks
- the first-class path remains easier to maintain than the sum of side paths around it

The desired bar is not:

- arbitrary repo-wide edits with no architectural cost
- correctness based only on prompt quality or maintainer memory
- treating scale problems as something to solve only after public growth arrives

## 8. Bottom Line

RebelAI already has unusually good foundations for scaling with clear boundaries.
The next step is not more abstraction for its own sake.
The next step is to turn more of the current intent into mechanical constraints:

- smaller core modules
- tighter write surfaces
- more import-boundary enforcement
- one obvious first-class verification path
- more disposable experimental branches

This is primarily a project-scaling investment.
AI-assisted development benefits from it, but so do maintainers, reviewers, and future contributors.
