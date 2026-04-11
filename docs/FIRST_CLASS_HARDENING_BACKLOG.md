# First-Class Hardening Backlog

Updated: 2026-04-11

This document is the execution backlog for RebelAI's current operating contract.

It is not a broad repo-quality backlog and it is not a public-launch checklist.
It exists to harden the current first-class path:

- signup closed
- personal or closed deployment
- low-cost hosting profile as the real day-to-day operating mode
- `RBX + SUU` as the primary product surface
- operator-default memory path: `prefix_live_blocks + episodic RAG`
- public-safe and system fallback memory path: `summary_window`

Use this backlog for the next work sessions unless the operating contract changes.

See [OPERATING_PLAN.md](./OPERATING_PLAN.md) for the policy layer. Use this document for execution sequencing.

## Working Rules

- Treat this as the default execution backlog for the current mode.
- Do not mix public-opening work into this backlog unless the operating contract changes.
- One work session should usually complete one backlog item or one clearly bounded slice of an item.
- Every behavior change must land with regression coverage in the same change.
- Prefer hardening the streaming chat success path over adding optional capabilities.
- New experimental features do not enter this backlog by default.

## Current Baseline

Closed or substantially improved already:

- Gate 1: Vault and secret write boundary hardened
- Gate 2: internal health made durable across processes
- Gate 5: partial progress made through job lifecycle stage persistence
- operating docs aligned to the current first-class mode

Representative evidence:

- [68_harden_vault_write_helpers.sql](../supabase/migrations/68_harden_vault_write_helpers.sql)
- [69_service_health_status.sql](../supabase/migrations/69_service_health_status.sql)
- [72_chat_job_lifecycle_stage.sql](../supabase/migrations/72_chat_job_lifecycle_stage.sql)
- [OPERATING_PLAN.md](./OPERATING_PLAN.md)

Still open in practice:

- full request-to-runner triage continuity
- reproducible low-cost operating runbook
- stronger experimental-boundary enforcement in code and defaults
- public-opening gates 3 through 5

## P0

### P0-1. Complete Chat Failure Triage Across the First-Class Path

Scope:

- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- [src/app/api/chat/job-persistence.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/job-persistence.ts)
- [src/app/api/chat/background-trigger.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/background-trigger.ts)
- [src/app/api/chat/jobs/[id]/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/jobs/[id]/route.ts)
- [src/app/api/internal/chat-job-runner/service.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/service.ts)
- [src/app/api/internal/chat-job-runner/post-generation-pipeline.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/post-generation-pipeline.ts)

Why:

- the job record now carries `lifecycle_stage` and `failure_stage`, but the full path still is not operator-readable from initial request admission through trigger dispatch
- current triage still requires jumping between route logs, job status, and runner logs

Done when:

- request acceptance, turn persistence, queue insert, trigger dispatch, runner pickup, provider request, streaming, and post-processing can be distinguished reliably
- one operator lookup can answer where the request stopped without reading scattered ad-hoc logs first
- failure-stage mapping is covered in tests for both streaming and batch paths

Current status as of 2026-04-11:

- [72_chat_job_lifecycle_stage.sql](../supabase/migrations/72_chat_job_lifecycle_stage.sql) added `lifecycle_stage` and `failure_stage`
- [src/app/api/internal/chat-job-runner/service.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/service.ts) and [src/app/api/internal/chat-job-runner/anthropic-batch-orchestrator.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/anthropic-batch-orchestrator.ts) now persist runner-side stages
- [src/app/api/chat/jobs/[id]/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/jobs/[id]/route.ts) now returns those fields
- [src/app/api/chat/background-trigger.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/background-trigger.ts) now persists `dispatching_runner_trigger` and `trigger_dispatched`, so queued jobs that fail before runner pickup are no longer indistinguishable from healthy handoff

### P0-2. Make the Low-Cost Profile Reproducible End-to-End

Scope:

- [docs/HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- [docs/GETTING_STARTED.md](./GETTING_STARTED.md)
- [README.md](../README.md)
- runner and janitor scripts under [scripts](/home/tmdduq96kr/projects/rebel-ai/scripts)

Why:

- the low-cost profile is the real first-class operating mode now
- a first-class mode that is not easy to re-run and verify is not actually first-class

Done when:

- the low-cost profile has one clear runbook for local verification and one clear runbook for deployed verification
- the operator can verify chat jobs, import jobs, janitor, and health checks with a small fixed checklist or script set
- the docs stop sounding like low-cost and managed public are equal day-to-day defaults

Current status as of 2026-04-11:

- [README.md](../README.md), [HOSTING_PROFILES.md](./HOSTING_PROFILES.md), and [GETTING_STARTED.md](./GETTING_STARTED.md) now reflect the current operating contract
- there is still no dedicated first-class smoke-check runbook or single operator verification flow

### P0-3. Tighten Experimental Boundaries Around the Core Chat Path

Scope:

- [src/app/api/internal/chat-job-runner/service.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/service.ts)
- [src/lib/chat/model-config.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/model-config.ts)
- [src/lib/chat-memory/index.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory/index.ts)
- [src/lib/embeddings.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/embeddings.ts)
- relevant dashboard settings surfaces under [src/app/dashboard](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard)

Why:

- the maintainer-operated default and the public-safe fallback are intentionally different
- if those boundaries stay implicit, optional modes slowly become hidden production requirements

Done when:

- operator-default, public-default, and system-fallback behavior are explicit in code and docs
- experimental delivery modes and provider-specific optimizations are clearly secondary to the streaming path
- failure in an experimental path does not silently redefine the core success contract

Current status as of 2026-04-11:

- the policy split is documented in [OPERATING_PLAN.md](./OPERATING_PLAN.md)
- the runtime still contains several optional provider and post-generation branches close to the core path

## P1

### P1-1. Add an Operator-Focused Triage View or Report Surface

Scope:

- internal health and status routes under [src/app/api/internal](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal)
- dashboard admin or developer surfaces under [src/app/dashboard](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard)

Why:

- the underlying signals are improving, but they still are not assembled into one operator-friendly view

Done when:

- the operator can inspect the latest degraded services and latest failed chat jobs without stitching together multiple raw endpoints manually
- the surface is useful for the closed personal deployment first, not designed around future public operations

Current status as of 2026-04-11:

- [src/app/api/internal/triage/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/triage/route.ts) now exposes a single internal JSON snapshot for degraded services plus recent failed chat jobs
- this is still an API surface, not yet a dashboard/operator page

### P1-2. Freeze Removal Candidates More Aggressively

Scope:

- [src/app/auth/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/auth/actions.ts)
- legacy compatibility paths under chat rendering and import code
- low-usage provider-specific branches in the runner

Why:

- deprecated paths still impose cognitive load even when they are not actively failing
- the current operating mode benefits more from fewer branches than from more optionality

Done when:

- commented-out and obviously deprecated flows stop receiving incidental changes
- removal candidates are explicitly marked or scheduled for deletion after usage review

## Parked Until the Operating Contract Changes

These are real future tasks, but they are not part of the current first-class hardening backlog.

- public abuse controls for reopening signup
- public rate and cost guardrails
- public invite or alpha flow
- R2 or other secondary asset backend migration
- treating multiple public hosting profiles as equal first-class modes

If one of these becomes active work, update [OPERATING_PLAN.md](./OPERATING_PLAN.md) first and then create a separate public-mode backlog.
