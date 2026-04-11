# Production Audit Backlog

Updated: 2026-04-12

This document turns `rebel-ai-production-audit-2026-04-12.html` into execution batches.

It does not reopen the operating contract from [OPERATING_PLAN.md](/home/tmdduq96kr/projects/rebel-ai/docs/OPERATING_PLAN.md). The repo already has a usable boundary model:

- first-class: the paths the maintainer actually runs and verifies
- experimental: allowed, opt-in paths that must not weaken the core chat contract
- removal candidates: compatibility or low-value paths that should not receive new product investment

If you want to keep the older shorthand, that maps cleanly to:

- Tier 1 = first-class
- Tier 2 = experimental
- Tier 3 = removal candidate / deprecated compatibility

## Decision

Do not spend another session debating tiers in the abstract.

The audit is already telling us where the real mismatch is:

- the documented boundary is mostly clear
- the code still mixes first-class and compatibility behavior in a few hot paths
- some non-core async paths still fail without durable operator visibility
- some large files are big for a reason, but several are big because too many contracts are mixed together

So the right move is:

1. freeze the support matrix so future work has a stable contract
2. tighten the boundary where code and docs disagree
3. make non-core failures visible and attributable
4. refactor large files only along those boundaries

Do not schedule generic "make big files smaller" work without a contract or failure-boundary outcome.

## Current Audit Themes

The 2026-04-12 audit clusters into six themes:

- chat runner orchestration is still too concentrated
- reprocess/regeneration does not follow the same durability contract as the main queue path
- legacy asset and token compatibility still leaks into the active runtime path
- secondary async failures are not always persisted into operator-facing health/triage signals
- dependency and runtime contracts are still too implicit
- several UI and action modules are now monoliths rather than cohesive seams

## P0

### P0-1. Freeze the Support Matrix and Failure-Signal Policy

Scope:

- [OPERATING_PLAN.md](/home/tmdduq96kr/projects/rebel-ai/docs/OPERATING_PLAN.md)
- [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md)
- first-class verification docs in [FIRST_CLASS_SMOKE_CHECKS.md](/home/tmdduq96kr/projects/rebel-ai/docs/FIRST_CLASS_SMOKE_CHECKS.md)

Why:

- the repo already has a usable boundary model, but the audit shows that future work can still reopen the same scope argument unless the support matrix is stated compactly
- this is the smallest change that makes every later refactor easier to judge

Done when:

- the repo names supported core, supported secondary/fallback, experimental, and removal-candidate paths in one compact matrix
- first-class smoke checks map only to the supported core
- each backlog item can say whether it hardens the supported core, protects a supported fallback, isolates an experimental path, or retires a removal candidate

### P0-2. Isolate Message Reprocess as Experimental

Scope:

- [route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/messages/reprocess/route.ts)
- the shared queue/runner lifecycle under [chat](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat)
- runner state helpers under [src/lib/chat](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat)

Why:

- the audit found that message reprocess performs the same domain action as the main chat path but bypasses its queue, job lifecycle, and recovery rules
- the maintainer no longer actively uses this path, but it is plausible future-user demand, which makes `experimental` the correct support level for now

Done when:

- reprocess is clearly labeled and treated as experimental in code and docs
- it does not implicitly inherit the same support promise as the main chat path
- it is isolated enough that failures in this path do not weaken the supported core
- if it is ever promoted later, promotion requires adopting the main queue/job lifecycle contract first
- tests lock the chosen contract directly

### P0-3. Extract Legacy Compatibility and Treat It as a Removal Candidate

Scope:

- [message-renderer.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/message-renderer.tsx)
- [message-content-pipeline.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/message-content-pipeline.ts)
- [asset-resolver.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/asset-resolver.ts)

Why:

- the repo says `RBX + SUU` is the primary path, but the audit still found active runtime compatibility behavior mixed into the core render path
- this is the clearest place where first-class and compatibility paths still compete inside the same functions
- the right near-term goal is not immediate deletion, but explicit separation followed by no new investment and later removal when the risk is acceptable

Done when:

- canonical RBX/SUU rendering stays on the first-class path
- legacy token and asset normalization lives behind an explicit adapter or compatibility module
- removal-candidate status is explicit, and new feature work does not extend these paths
- a later delete decision only depends on usage evidence and migration confidence, not on disentangling the core renderer first
- new rendering features do not need to touch legacy branches by default
- regression tests prove that compatibility behavior stays outside the primary render contract

### P0-4. Differentiate Summary and Translation Observability

Scope:

- [translation-trigger.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-trigger.ts)
- [job-lifecycle-store.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/job-lifecycle-store.ts)
- [summary-trigger.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/summary-trigger.ts)
- health and monitoring modules under [src/lib/monitoring](/home/tmdduq96kr/projects/rebel-ai/src/lib/monitoring)

Why:

- the audit showed that not every background path deserves the same alerting contract
- summary is not just another experimental helper because `summary_window` remains a maintained default and system fallback
- translation remains experimental and should not page the same way as the supported core

Done when:

- summary failures leave durable triage signals and remain attributable to a concrete stage
- repeated summary problems can be investigated without log archaeology
- translation failures are at least observable in lightweight monitoring or triage, but do not count as supported-core health regressions by default
- stage persistence failures that affect the supported core still leave durable operator-visible state

## P1

### P1-1. Make the Runtime and Dependency Contract Mechanical

Scope:

- [package.json](/home/tmdduq96kr/projects/rebel-ai/package.json)
- lockfile updates in [package-lock.json](/home/tmdduq96kr/projects/rebel-ai/package-lock.json)
- repo root version files such as `.nvmrc`

Why:

- the audit found undeclared direct imports, unused dependencies, and a Node 20 contract that is still too documentation-driven
- this is a fast way to remove avoidable environment drift before deeper refactors

Done when:

- direct imports are direct dependencies
- dead direct dependencies are removed
- the repo pins Node 20 with a machine-readable version file
- setup docs no longer carry the whole burden of runtime consistency

### P1-2. Split the Chat Job Runner by Stage, Not by Line Count

Scope:

- [service.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/service.ts)
- adjacent runner modules under [chat-job-runner](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner)

Suggested seams:

- context loading
- model and provider preparation
- generation execution
- post-generation writes
- terminal status persistence

Why:

- the audit is right that `service.ts` is still the biggest structural risk surface
- but the fix is not "split until smaller"; the fix is to center the file on lifecycle orchestration only

Done when:

- `service.ts` mainly owns stage order, retries, and terminal state transitions
- stage-specific logic lives in narrower modules with direct tests
- adding a new provider or post-processing rule does not require rereading one thousand lines of mixed concerns

## P2

### P2-1. Decompose Large Chat UI Surfaces Along Feature Boundaries

Scope:

- [ChatInterface.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx)
- [ChatSummariesPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatSummariesPanel.tsx)
- [LorebookPanel.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/LorebookPanel.tsx)

Why:

- these files are now large enough that review cost and local reasoning cost are both too high
- however, they should be split only after the compatibility and support boundaries are clearer

Done when:

- each surface has a smaller state/orchestration shell
- rendering, data hooks, mutations, and compatibility helpers are split into cohesive modules
- feature work can land without touching unrelated UI branches

### P2-2. Finish Shrinking Server Action Monoliths

Scope:

- [actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/account/actions.ts)
- any closely related dashboard server action files that still mix many form/update contracts

Why:

- the previous backlog already improved shared action flow, but the audit still flagged account actions as too large
- this is lower urgency than boundary mismatches and runner integrity, but still worth finishing

Done when:

- account settings areas are split into smaller action modules or shared helpers with stable input contracts
- tests stay aligned with each extracted boundary

### P2-3. Prune Over-Specified Comments and Dead Compatibility Fragments

Scope:

- comment-heavy files identified in the audit, especially chat summaries, asset resolution, and message rendering

Why:

- the audit called out a repeated pattern where comments are longer than the logic they describe
- this does not break correctness by itself, but it slows review and makes stale design explanations harder to spot

Done when:

- comments explain intent, invariants, or sharp edges only
- dead or commented-out compatibility remnants are removed instead of narrated

## Recommended Order

1. P0-1 Freeze the support matrix and failure-signal policy
2. P0-2 Isolate message reprocess as experimental
3. P0-3 Extract legacy compatibility and mark it as a removal candidate
4. P1-1 Make Node and dependency contracts mechanical
5. P0-4 Differentiate summary and translation observability
6. P1-2 Split the chat job runner by stage
7. P2 UI and server-action decomposition after the contract edges are stable

## Session Rule

For the next few sessions:

- start from this backlog, not another broad review
- take one batch at a time
- require a regression test when behavior changes
- prefer contract-alignment refactors over cosmetic size reduction
- update this file after each batch lands
