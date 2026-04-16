# Operating Plan

This document is a maintainer operating note for RebelAI.
It captures the current supported mode, boundary decisions, and public-opening gates.
It is not the exact source of truth for schema or route-level behavior.

It exists to keep one real first-class path, prevent mode sprawl, and define the gates that must close before public signup opens.
For the stable doctrine behind `core / fallback / experimental / removal`, see [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md).

## 1. Current Operating Mode

Status: first-class now

- Signup stays closed.
- The product is operated as a personal, closed deployment.
- The real first-class environment is the low-cost profile the maintainer actually runs and can reproduce locally.
- Keep one storage/backend path only. Do not add R2 or another asset backend until there is measured pressure that the current path cannot absorb.
- `character-assets` and `module-assets` stay private by default. Asset delivery for the supported path is authenticated or signed at runtime, not anonymous public bucket reads.
- For maintainer-operated chats, the active first-class memory profile is `prefix_live_blocks + episodic RAG` because that is the path the maintainer actually uses and should keep verifying.
- The code-level fallback remains `summary_window` when memory settings are missing or public-safe defaults are needed.
- Treat `RBX + SUU`, authenticated chat, and background job execution as the supported core.

Why this is the current mode:

- The project is already valuable as a personal tool and does not need public traffic to justify itself.
- The highest-risk internal boundary fixes are now closed, but public-opening gates still remain.
- A solo maintainer should not carry two first-class operating modes at once.

Primary evidence:

- `RBX + SUU` is already the native, reduced-surface path: [rbx-parser.ts](../src/lib/rbx-parser.ts), [suu-import-validation.ts](../src/lib/suu-import-validation.ts), [message-renderer.tsx](../src/app/dashboard/chats/[id]/utils/message-renderer.tsx)
- Low-cost deployment is already documented as a supported profile: [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- Signup is intentionally closed in the current auth flow: [actions.ts](../src/app/auth/actions.ts)
- Private asset delivery is now the live storage contract: [73_private_asset_delivery.sql](../supabase/migrations/73_private_asset_delivery.sql), [route.ts](../src/app/api/chats/[chatId]/assets/route.ts), [character-avatar.ts](../src/lib/assets/character-avatar.ts)

## 2. Future Public Mode

Status: target mode, not first-class yet

- Public use is allowed only after the open gates in section 4 are closed.
- Start with a small invite-only alpha before general signup.
- When public traffic is accepted, the default public profile becomes `Vercel Pro + Supabase Pro`.
- The public product default memory profile stays `summary_window` at first. `prefix_live_blocks` and episodic RAG remain opt-in until they are proven stable enough for outside users.
- Public mode should still keep one official storage/backend path first. Do not combine public launch with an R2 migration.
- Public opening does not imply public asset buckets. Keep `character-assets` and `module-assets` private unless there is an explicit written decision to reopen anonymous reads and the operator checks are updated with that new contract.
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
- Summary failures that affect the maintained default or system fallback should always leave durable triage evidence, even when they are not treated as full core-health outages.

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

### 3.7 Support Matrix

This is not a new product-tier system. It is a compact support matrix layered on top of the existing first-class / experimental / removal-candidate boundary model.

| Path class                     | Examples                                                                                                                                                        | Support promise                                                                                        | Signal expectation                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Supported core                 | `RBX + SUU`, authenticated chat request -> queue -> runner -> durable turn state, secret and admin boundaries                                                   | Actively maintained and part of the real first-class path                                              | Failures must show up in operator health and triage, and they should block release when unresolved                          |
| Supported secondary / fallback | `summary_window`, summary generation that supports the maintained default or system fallback                                                                    | Maintained because it supports the active defaults, even if it is not always the main interactive path | Durable triage is required. Escalate to health degradation when repeated failures threaten the maintained fallback contract |
| Experimental                   | Message reprocess, translation trigger, bilingual/context enhancements beyond the maintained defaults, provider-specific delivery modes beyond the default path | Allowed and useful, but not part of the day-to-day support promise                                     | Lightweight monitoring or triage is enough by default. Failures must not weaken the supported core                          |
| Removal candidate              | Legacy asset/token compatibility and deprecated migration-only branches                                                                                         | No new product investment. Isolate first, then delete when safe                                        | Keep them out of the core path. Only add enough visibility to support migration and removal                                 |

## 4. Open Gates

Public signup stays closed until every item below is closed or deliberately waived with written rationale.

Current status on 2026-04-11:

- Gate 1: closed
- Gate 2: closed
- Gate 3: open
- Gate 4: open
- Gate 5: open

### Gate 1. Secret-write boundary is fixed

Status: closed on 2026-04-11

- Vault write helpers are now restricted to the service role, requester-bound ownership checks are enforced again, and legacy over-permissive helper grants were revoked.
- Keep the verification in the normal release path so future schema drift does not reopen the boundary.

Evidence:

- [68_harden_vault_write_helpers.sql](../supabase/migrations/68_harden_vault_write_helpers.sql)
- [schema.sql](../supabase/schema.sql)
- [vault-rpc.integration.test.ts](../src/lib/rls/vault-rpc.integration.test.ts)
- [SECURITY.md](../SECURITY.md)

### Gate 2. Runner health is durable across processes

Status: closed on 2026-04-11

- Service health now persists durable snapshots in the database and the health route prefers those snapshots over process-local counters.
- The operator can now distinguish durable vs fallback health reads via `healthSource`, even across deploys and restarts.

Evidence:

- [69_service_health_status.sql](../supabase/migrations/69_service_health_status.sql)
- [70_fix_service_health_rpc.sql](../supabase/migrations/70_fix_service_health_rpc.sql)
- [71_rename_service_health_rpc_args.sql](../supabase/migrations/71_rename_service_health_rpc_args.sql)
- [trigger-tracker.ts](../src/lib/monitoring/trigger-tracker.ts)
- [service-health-store.ts](../src/lib/monitoring/service-health-store.ts)
- [route.ts](../src/app/api/internal/health/route.ts)

### Gate 3. Public abuse controls exist

Status: open

- Add a minimum viable public control set: rate limiting, signup policy, usage ceiling, and cost guardrails.
- Public mode must fail closed when limits are exceeded.

Evidence:

- [route.ts](../src/app/api/internal/chat-admin/route.ts)
- [route.ts](../src/app/api/chat/route.ts)

### Gate 4. One public deployment profile is frozen

Status: open

- Pick exactly one official public profile and document it as the only supported public path.
- Do not open signup while both low-cost and managed public operation are treated as equal first-class modes.

Evidence:

- [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- [README.md](../README.md)

### Gate 5. Failure triage is operator-usable

Status: open

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
- Message reprocess/regeneration paths that do not use the supported main queue contract
- Translation trigger and bilingual/context enhancements that are not required for successful baseline chat
- Summary enhancements beyond the maintained `summary_window` default and system fallback
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
- Legacy asset/token compatibility branches that are no longer needed once RBX/SUU is the dominant path
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

1. Freeze one actual current deployment profile and update docs to reflect that reality.
2. Add a minimum viable public abuse-control set before reconsidering signup.
3. Improve failure triage until operator-visible stages map cleanly to request acceptance, persistence, trigger, runner, and post-processing.
4. Move non-core features behind clearer experimental boundaries.
5. Revisit public signup only after gates 3 through 5 are closed.

## Decision Rules

Use these rules for future scope decisions.

- If a feature increases the number of ways the product runs, it is guilty until proven necessary.
- If the maintainer does not actively run and verify a mode, that mode is not first-class.
- If a public-facing feature needs different reliability guarantees, treat it as a new operating contract, not a small toggle.
- If a cost optimization adds a new backend boundary, defer it until there is measured pressure.
