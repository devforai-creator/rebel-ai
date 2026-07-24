# Project Scaling Hardening

Status: Active
Role: Map
Last reviewed: 2026-07-25
Source of truth: code, tests, `package.json`, and the active deployment
Revisit when: the first-class chat path, runner stages, client lifecycle, or support boundaries change

This document is an engineering map for keeping RebelAI maintainable as product scope, runtime
complexity, contributor surface area, and automation usage grow.

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

Current state: the first-class path and its verification entry points are substantially more
explicit than when this note was first written. The remaining scaling debt is concentrated in
client chat lifecycle coordination, runner-stage ownership, durable writes, and physical isolation
of experimental paths.

Why the current posture is already above average:

- support and trust boundaries are explicit in [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md)
- the active operating contract is written down in [OPERATING_PLAN.md](./OPERATING_PLAN.md)
- support tiers are represented in code in [support-tier.ts](../src/lib/support-tier.ts)
- browser/server Supabase usage already has explicit boundaries in [client.ts](../src/lib/supabase/client.ts), [server.ts](../src/lib/supabase/server.ts), and [admin.ts](../src/lib/supabase/admin.ts)
- boundary drift already has at least one dedicated static check in [check-browser-supabase-client.js](../scripts/check-browser-supabase-client.js)
- the repo has strong test density around auth, chat, queue, storage, import, and support-tier behavior
- `npm run verify:core` provides a compact maintained-chat-path gate
- [FIRST_CLASS_PATH_MAP.md](./FIRST_CLASS_PATH_MAP.md) names the request, queue, runner, durable-write,
  and best-effort follow-up owners
- the chat API delegates parsing, admission, persistence, submission, and post-submit effects to
  adjacent modules instead of keeping them all inline
- provider model metadata now lives in provider-specific catalogs under
  [src/lib/models/catalog/](../src/lib/models/catalog/)

Why the work is not complete:

- some core chat paths still concentrate too much orchestration in a few files
- queue, runner, memory, and post-processing behavior still requires too much multi-file mental stitching
- client chat state still reconciles SSR, optimistic, Realtime, stream, and polling inputs across
  overlapping state paths
- important turn, job, summary, and metadata writes still need narrower ownership contracts
- experimental and fallback behavior is conceptually separated better than it is physically separated

## 3. Main Risk Zones

These are the areas where growth pressure can most easily turn into future maintenance cost.

### 3.1 Chat request orchestration

- [src/app/api/chat/route.ts](../src/app/api/chat/route.ts)
- [src/app/api/chat/job-persistence.ts](../src/app/api/chat/job-persistence.ts)
- [src/lib/chat/turn-write.ts](../src/lib/chat/turn-write.ts)

Risk:

- the route shell is now split into adjacent modules, but durable user-turn persistence and job
  enqueue are still separate operations and optional effects remain close to the core submission path

Desired end state:

- preserve the current parsing/admission/submission split while making the critical durable write
  atomic and keeping optional side effects outside that transaction

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
- [src/lib/models/catalog/](../src/lib/models/catalog/)

Risk:

- model capabilities are centralized, but memory modes and experimental post-processing can still
  widen the supported surface or make fallback behavior ambiguous

Desired end state:

- keep capability-driven model behavior centralized while making support tier, feature enablement,
  and runtime dispatch explicit for memory and experimental paths

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

### Priority 1. Keep the compact first-class verification command aligned

Status: shipped; maintain as the first-class path changes.

`npm run verify:core` now combines the browser Supabase boundary check, focused core-path tests, and
typecheck.

Target coverage:

- authenticated chat request admission
- job enqueue + runner trigger path
- runner execution service
- durable turn writes
- support-tier and boundary checks

Why it matters:

- contributors need a short, obvious verification target after every edit in the first-class path

### Priority 2. Preserve the chat API responsibility split and narrow its durable write

Status: substantially shipped; atomic submission remains.

[src/app/api/chat/route.ts](../src/app/api/chat/route.ts) now delegates to:

- [request-contract.ts](../src/app/api/chat/request-contract.ts) for parsing and normalization
- [chat-admission.ts](../src/app/api/chat/chat-admission.ts) for ownership and admission
- [submit-chat-job.ts](../src/app/api/chat/submit-chat-job.ts) for post-admission orchestration
- [job-persistence.ts](../src/app/api/chat/job-persistence.ts) for turn and job persistence
- [post-submit-effects.ts](../src/app/api/chat/post-submit-effects.ts) for optional follow-ups

The remaining high-value step is to make user-turn/message persistence and job enqueue one
database-atomic operation without collapsing these responsibilities back into the route.

Why it matters:

- this reduces hidden coupling in one of the most important growth-sensitive paths

### Priority 3. Turn runner stages into an explicit pipeline contract

Status: in progress.

Make the runner stages return small typed result objects with stable names and isolated side effects.

Stage modules now exist for execution context, provider request, streaming response, post-processing,
assistant finalization, and post-generation work. The remaining work is to reduce the size and
cross-stage knowledge of the largest modules and narrow which stages may perform durable writes.

Why it matters:

- this keeps runner evolution from turning into one large mental model that only a maintainer can safely edit

### Priority 4. Add import-layer checks

Status: partial.

Add lightweight checks for rules such as:

- browser code cannot import admin helpers
- dashboard client hooks cannot import server-only modules
- experimental modules cannot be imported from the supported synchronous core path without an explicit adapter

Why it matters:

- architectural drift often starts as import drift before it becomes logic drift

### Priority 5. Maintain the first-class path map

Status: shipped.

[FIRST_CLASS_PATH_MAP.md](./FIRST_CLASS_PATH_MAP.md) now answers:

- what is the exact supported chat success path
- which modules are allowed to write durable state in that path
- which side effects are best-effort only

Why it matters:

- the project should not depend on unwritten maintainer memory to explain the main path

### Priority 6. Make experimental features disposable by default

Status: in progress.

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
- one job-scoped client lifecycle model
- continued alignment of `verify:core` and [FIRST_CLASS_PATH_MAP.md](./FIRST_CLASS_PATH_MAP.md)
- more disposable experimental branches

This is primarily a project-scaling investment.
AI-assisted development benefits from it, but so do maintainers, reviewers, and future contributors.
