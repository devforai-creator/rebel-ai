# Operating Plan

This document is the current operating contract for RebelAI.

It exists to keep one real first-class path, prevent mode sprawl, and define the gates that must close before public signup opens.

## 1. Current Operating Mode

Status: first-class now

- Signup stays closed.
- The product is operated as a personal, closed deployment.
- The real first-class environment is the low-cost profile the maintainer actually runs and can reproduce locally.
- Keep one storage/backend path only. Do not add R2 or another asset backend until there is measured pressure that the current path cannot absorb.
- For maintainer-operated chats, the active first-class memory profile is `prefix_live_blocks + episodic RAG` because that is the path the maintainer actually uses and should keep verifying.
- The code-level fallback remains `summary_window` when memory settings are missing or public-safe defaults are needed.
- Treat `RBX + SUU`, authenticated chat, and background job execution as the supported core.

Why this is the current mode:

- The project is already valuable as a personal tool and does not need public traffic to justify itself.
- The codebase still has open operational and security boundaries that should be closed before exposing signup.
- A solo maintainer should not carry two first-class operating modes at once.

Primary evidence:

- `RBX + SUU` is already the native, reduced-surface path: [rbx-parser.ts](../src/lib/rbx-parser.ts), [suu-import-validation.ts](../src/lib/suu-import-validation.ts), [message-renderer.tsx](../src/app/dashboard/chats/[id]/utils/message-renderer.tsx)
- Low-cost deployment is already documented as a supported profile: [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- Signup is intentionally closed in the current auth flow: [actions.ts](../src/app/auth/actions.ts)

## 2. Future Public Mode

Status: target mode, not first-class yet

- Public use is allowed only after the open gates in section 4 are closed.
- Start with a small invite-only alpha before general signup.
- When public traffic is accepted, the default public profile becomes `Vercel Pro + Supabase Pro`.
- The public product default memory profile stays `summary_window` at first. `prefix_live_blocks` and episodic RAG remain opt-in until they are proven stable enough for outside users.
- Public mode should still keep one official storage/backend path first. Do not combine public launch with an R2 migration.
- Public mode should optimize for operator simplicity, not lowest cost.

Why this is a future mode:

- Public signup changes the support contract even if traffic is low.
- "Unpromoted but open" is still a public service from a reliability and abuse perspective.
- The current repo already documents a managed production profile, but that does not make it first-class until the maintainer is ready to carry it operationally.

Primary evidence:

- Managed production is already the recommended production path: [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- The README explicitly presents both managed and low-cost profiles, which increases mode count unless one is chosen as operational default: [README.md](../README.md)

## 3. Common First-Class Path

These are the code paths that must be hardened now because both the current mode and the future public mode depend on them.

### 3.1 Native character input and rendering

- Keep `RBX + SUU` as the primary and preferred path.
- Avoid re-expanding raw HTML/CSS/script-like surfaces.
- New character features should extend RBX/SUU, not create side channels.

Evidence:

- [rbx-parser.ts](../src/lib/rbx-parser.ts)
- [suu-import-validation.ts](../src/lib/suu-import-validation.ts)
- [message-renderer.tsx](../src/app/dashboard/chats/[id]/utils/message-renderer.tsx)

### 3.2 Core chat success path

- One supported path: request -> persistence -> queue/runner -> streamed assistant update -> durable turn state.
- This path must work without relying on experimental provider-specific branches.
- Verification should stay concentrated here.

Evidence:

- [route.ts](../src/app/api/chat/route.ts)
- [job-persistence.ts](../src/app/api/chat/job-persistence.ts)
- [service.ts](../src/app/api/internal/chat-job-runner/service.ts)
- [turn-write.ts](../src/lib/chat/turn-write.ts)

### 3.3 Memory tiers

- Separate operator default, public default, and system fallback instead of forcing one memory mode to serve every job.
- Operator default: `prefix_live_blocks + episodic RAG` for maintainer-operated chats.
- Public default: `summary_window` until the higher-complexity path has stronger operational evidence.
- System fallback: `summary_window` whenever memory config is missing or needs a safe default.

Evidence:

- [model-config.ts](../src/lib/chat/model-config.ts)
- [index.ts](../src/lib/chat-memory/index.ts)
- [index.ts](../src/lib/chat-summaries/index.ts)
- [embeddings.ts](../src/lib/embeddings.ts)
- [memory-modes-v1.md](./memory-modes-v1.md)

### 3.4 Secret ownership and privileged boundaries

- User-owned keys, admin bridge access, and internal trigger authorization must remain explicit and narrow.
- Any privilege escalation or secret-write loophole blocks public opening.

Evidence:

- [actions.ts](../src/app/dashboard/api-keys/actions.ts)
- [route.ts](../src/app/api/internal/chat-admin/route.ts)
- [admin.ts](../src/lib/supabase/admin.ts)
- [SECURITY.md](../SECURITY.md)

### 3.5 Background job health and recovery visibility

- Chat runner and summary generation need durable health signals, not only in-process memory.
- Failures must be visible from one place and attributable to a concrete stage.

Evidence:

- [trigger-tracker.ts](../src/lib/monitoring/trigger-tracker.ts)
- [route.ts](../src/app/api/internal/health/route.ts)
- [summary-trigger.ts](../src/lib/chat/summary-trigger.ts)

### 3.6 One reproducible deployment path

- One environment profile should be reproducible end-to-end with current docs.
- New operational fixes should be validated against that single path first.

Evidence:

- [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [internal-api-origin.ts](../src/lib/internal-api-origin.ts)
- [background-trigger.ts](../src/app/api/chat/background-trigger.ts)

## 4. Open Gates

Public signup stays closed until every item below is closed or deliberately waived with written rationale.

### Gate 1. Secret-write boundary is fixed

- Fix the current gap around secret creation/ownership enforcement before exposing public signup.
- Re-run security verification after the fix and keep the check in the normal release path.

Evidence:

- [63_reconcile_production_public.sql](../supabase/migrations/63_reconcile_production_public.sql)
- [schema.sql](../supabase/schema.sql)
- [SECURITY.md](../SECURITY.md)

### Gate 2. Runner health is durable across processes

- Replace or supplement process-local health tracking with a durable signal.
- The operator must be able to tell whether triggers fired, runners picked up jobs, and summaries advanced across deploys/restarts.

Evidence:

- [trigger-tracker.ts](../src/lib/monitoring/trigger-tracker.ts)
- [route.ts](../src/app/api/internal/health/route.ts)

### Gate 3. Public abuse controls exist

- Add a minimum viable public control set: rate limiting, signup policy, usage ceiling, and cost guardrails.
- Public mode must fail closed when limits are exceeded.

Evidence:

- [route.ts](../src/app/api/internal/chat-admin/route.ts)
- [route.ts](../src/app/api/chat/route.ts)

### Gate 4. One public deployment profile is frozen

- Pick exactly one official public profile and document it as the only supported public path.
- Do not open signup while both low-cost and managed public operation are treated as equal first-class modes.

Evidence:

- [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- [README.md](../README.md)

### Gate 5. Failure triage is operator-usable

- The maintainer must be able to answer: did request acceptance fail, job persistence fail, trigger dispatch fail, runner execution fail, or post-processing fail.
- If that answer still requires digging across ad-hoc branches or local-only counters, public signup is premature.

Evidence:

- [service.ts](../src/app/api/internal/chat-job-runner/service.ts)
- [post-generation-pipeline.ts](../src/app/api/internal/chat-job-runner/post-generation-pipeline.ts)
- [runner-trigger-monitor.ts](../src/lib/chat/runner-trigger-monitor.ts)

## 5. Experimental

These features are allowed, but they are not first-class. They should be opt-in, clearly labeled, and never required for the core chat path.

- R2 or any secondary asset/storage backend
- Provider-specific delivery modes and optimizations beyond the default chat path
- Summary/translation/bilingual context enhancements that are not required for successful baseline chat
- Multiple hosting profiles treated as equally supported day-to-day
- Advanced operator convenience tools that do not change core user value

Representative evidence:

- [service.ts](../src/app/api/internal/chat-job-runner/service.ts)
- [post-generation-pipeline.ts](../src/app/api/internal/chat-job-runner/post-generation-pipeline.ts)
- [summary-trigger.ts](../src/lib/chat/summary-trigger.ts)
- [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)

Rule:

- Experimental features default off or de-emphasized.
- They must not add failure risk to the common first-class path.

## 6. Removal Candidates

These paths should not receive new investment. Measure real usage, then delete if they are not earning their keep.

- Commented-out signup remnants and related dead flow leftovers
- Legacy compatibility branches that are no longer needed once RBX/SUU is the dominant path
- Low-usage provider-specific branches that add more operational modes than user value
- Admin/utility features that are rarely used and do not strengthen the core product

Representative evidence:

- [actions.ts](../src/app/auth/actions.ts)
- [message-renderer.tsx](../src/app/dashboard/chats/[id]/utils/message-renderer.tsx)
- [message-content-pipeline.ts](../src/app/dashboard/chats/[id]/utils/message-content-pipeline.ts)
- [ChatInterface.tsx](../src/app/dashboard/chats/[id]/ChatInterface.tsx)

Rule:

- No new features on removal candidates.
- If a branch is kept temporarily, it should still be treated as deprecated.

## Immediate Priorities

This is the recommended order for the next cycle.

1. Fix the secret/Vault write boundary and document the invariant.
2. Add durable runner/summary health visibility that survives process restarts.
3. Freeze one actual current deployment profile and update docs to reflect that reality.
4. Move non-core features behind clearer experimental boundaries.
5. Revisit public signup only after gates 1 through 4 are closed.

## Decision Rules

Use these rules for future scope decisions.

- If a feature increases the number of ways the product runs, it is guilty until proven necessary.
- If the maintainer does not actively run and verify a mode, that mode is not first-class.
- If a public-facing feature needs different reliability guarantees, treat it as a new operating contract, not a small toggle.
- If a cost optimization adds a new backend boundary, defer it until there is measured pressure.
