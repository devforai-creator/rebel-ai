# Internal Hardening Audit Backlog

Updated: 2026-04-16

This document turns [`internal-hardening-audit-2026-04-16.html`](../reviews/internal-hardening-audit-2026-04-16.html) into execution batches.

It is not a generic repo-quality wishlist.
It is the follow-up backlog for the specific production-risk findings that remain open after the 2026-04-16 internal hardening audit.

Use this backlog to drive the next work sessions unless a higher-priority production incident appears.

## Working Rules

- Treat this as an execution backlog, not a finding archive.
- Batch work by failure boundary and write scope, not by raw issue count.
- One session should usually complete one backlog item or one clearly bounded slice.
- Every behavior change must land with regression coverage in the same change.
- Prefer isolating experimental and compatibility paths away from the supported core before adding new capability.
- Do not reopen broad repo-wide review until the P0 items here are either done or consciously deferred.

## Current Audit Themes

The 2026-04-16 audit clusters into these repeated themes:

- experimental translation behavior still sits too close to the core chat acceptance path
- at least one destructive multi-step write flow is still non-atomic
- deployed smoke checks exist as documentation and scripts, but not as a real gate
- some docs still describe an older contract rather than the current `RBX + SUU` surface
- the chat detail shell is still a large change surface and remains partially outside the global coverage denominator
- some server-side correctness still depends on trusting queued payload context more than the canonical DB transcript

## Status Snapshot

Current status after the 2026-04-16 hardening sessions:

- Completed: `P0-1`, `P0-2`, `P0-4`, `P1-2`, `P1-3`
- In progress: `P1-1`
- Still open: `P0-3`
- Lower-priority carry item: `P2-1`

Use the next review pass to confirm the completed items stay closed and to decide whether `P1-1`, `P0-3`, or `P2-1` should be the next real work item.

## P0

### P0-1. Fully Isolate Translation Trigger from the Core Chat Success Path

Status: completed on 2026-04-16

Scope:

- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- [src/lib/chat/translation-trigger.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-trigger.ts)
- [src/lib/internal-api-origin.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/internal-api-origin.ts)
- matching tests in [src/lib/chat/translation-trigger.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-trigger.test.ts) and [src/app/api/chat/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.test.ts)

Why:

- the audit confirmed that translation is documented as experimental and non-blocking, but the current call site can still throw before the core request returns `202`
- this is a direct violation of the supported-core contract for the maintainer-run chat path

Done when:

- translation trigger setup cannot throw through the main `/api/chat` request after job enqueue succeeds
- missing or invalid `INTERNAL_API_ORIGIN` degrades translation only, not core chat acceptance
- tests prove that translation misconfiguration does not change the response contract of the main chat path
- any translation failure still remains observable through lightweight monitoring or triage

### P0-2. Make Character Module Relinking Atomic

Status: completed on 2026-04-16

Scope:

- [src/app/dashboard/characters/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/actions.ts)
- any new SQL helper or RPC under [supabase/migrations](/home/tmdduq96kr/projects/rebel-ai/supabase/migrations)
- regression coverage in [src/app/dashboard/characters/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/characters/actions.test.ts)

Why:

- the audit confirmed that `updateCharacter` deletes existing module links before inserting the replacement set
- insert failure leaves the character in a partially applied state even though the user receives an error

Done when:

- character update plus module relink succeeds or fails as one boundary
- failed relink no longer leaves cleared `character_modules` behind
- regression tests cover delete-success / insert-failure explicitly
- follow-up cleanup such as orphan-module deletion only runs after the new link set is durably in place

### P0-3. Turn Deployed Smoke Checks into a Real Post-Deploy Gate

Status: open

Scope:

- [docs/FIRST_CLASS_SMOKE_CHECKS.md](../FIRST_CLASS_SMOKE_CHECKS.md)
- [package.json](/home/tmdduq96kr/projects/rebel-ai/package.json)
- [.github/workflows/test.yml](/home/tmdduq96kr/projects/rebel-ai/.github/workflows/test.yml)
- any supporting workflow or release doc changes needed for deployed verification

Why:

- the repo already has an explicit smoke-check contract for changes that touch internal routes, runners, env wiring, and signed asset delivery
- today that contract is still mostly manual, so the most deployment-specific regressions can slip past otherwise strong CI
- the current ambiguity is not whether smoke exists, but whether it is a local/pre-deploy check or a deployed/post-deploy release gate

Done when:

- the repo has one explicit place where deployed smoke verification is required after deploy and before closing high-risk changes
- the gate is mechanical enough that “forgot to run it” stops being a normal failure mode
- the chosen mechanism is documented clearly, including how secrets and target origin are supplied
- the gate distinguishes local rehearsal from deployed verification, and passive from active checks, so operators do not accidentally consume live work during routine verification

### P0-4. Repair Runtime-Contract Drift in Schema and Product Docs

Status: completed on 2026-04-16

Scope:

- [DATABASE_SCHEMA.md](/home/tmdduq96kr/projects/rebel-ai/DATABASE_SCHEMA.md)
- [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md)
- [docs/OPERATING_PLAN.md](../OPERATING_PLAN.md)
- any directly affected reference docs under [docs](/home/tmdduq96kr/projects/rebel-ai/docs)

Why:

- the audit found that the schema reference still mixes an older “HTML allowed” description with the current constrained markdown plus `RBX + SUU` contract
- this kind of doc drift is not cosmetic; it reopens attack surface and feature-scope arguments that the codebase is actively trying to close

Done when:

- message content, asset delivery, and rendering docs match the current implementation contract
- removed or deprecated HTML-era assumptions are explicitly retired instead of silently lingering
- the docs map points readers to the current operating contract first
- future maintainers can no longer plausibly infer that reintroducing raw HTML is an already-supported path

## P1

### P1-1. Reduce the Blast Radius of the Chat Detail Shell

Status: in progress

Shipped slices on 2026-04-16:

- split `DebugModal` into smaller adjacent sections
- extracted `queued-chat-api` and `queued-chat-runtime` helpers from `useQueuedChat`
- extracted chat metadata-view derivation into `useChatMetadataViews`
- extracted the composer UI into `ChatComposer`

Carry-forward focus:

- only continue if the next slice is still a low-risk seam
- prefer transcript/message-pane or other UI-shell splits before touching the deeper queued-chat state machine again

Scope:

- [src/app/dashboard/chats/[id]/ChatInterface.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/ChatInterface.tsx)
- [src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts)
- [src/app/dashboard/chats/[id]/components/DebugModal.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/components/DebugModal.tsx)
- [src/app/dashboard/chats/[id]/utils/message-renderer.tsx](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/utils/message-renderer.tsx)
- [vitest.config.ts](/home/tmdduq96kr/projects/rebel-ai/vitest.config.ts)

Why:

- the audit did not find an immediate correctness blocker here, but it did confirm that this is still the largest UI change surface and is partially excluded from the global coverage denominator
- as long as the shell stays this concentrated, small behavior changes remain expensive to reason about

Done when:

- the chat detail route is split along feature seams rather than raw line count
- high-risk runtime boundaries regain normal coverage expectations or have a tighter, explicit replacement contract
- bundle size and change-surface size both move downward from the current baseline
- future chat feature work no longer defaults to editing the same few giant files

### P1-2. Tighten the Transcript-Source Contract in the Chat Runner

Status: completed on 2026-04-16

Scope:

- [src/app/api/internal/chat-job-runner/execution-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.ts)
- [src/app/api/internal/chat-job-runner/execution-context.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.test.ts)
- related transcript helpers under [src/lib/chat](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat)

Why:

- the audit found a real design trade-off: the runner can use payload transcript windows instead of rebuilding the canonical DB transcript
- this is not automatically wrong, but the contract needs to be tighter so performance optimizations do not silently redefine server truth

Done when:

- the code states exactly when payload transcript is allowed and what invariants must hold
- tests prove the chosen invariants directly
- operator-facing debug metrics make transcript source choice obvious during triage
- the supported core does not depend on undocumented payload assumptions

### P1-3. Close the API Key Create Rollback Gap

Status: completed on 2026-04-16

Scope:

- [src/app/dashboard/api-keys/actions.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/actions.ts)
- any matching Vault/DB helper changes under [src/lib/supabase](/home/tmdduq96kr/projects/rebel-ai/src/lib/supabase) or [supabase/migrations](/home/tmdduq96kr/projects/rebel-ai/supabase/migrations)
- regression coverage in [src/app/dashboard/api-keys/actions.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/api-keys/actions.test.ts)

Why:

- current create flow tries to compensate for DB insert failure by deleting the Vault secret, but cleanup failure is not part of the result contract
- the blast radius is smaller than the character relink issue, but the remaining gap still creates orphaned-secret cleanup debt

Done when:

- API key create either commits fully or returns an explicit rollback failure signal
- orphaned Vault state cannot be created silently on the common failure path
- tests cover DB-failure plus rollback-failure behavior explicitly

## P2

### P2-1. Converge Docs and Defaults Around One Day-to-Day Operating Profile

Status: lower-priority carry item

Note:

- `P0-4` already reclassified the doc roles and made the current maintainer-operated low-cost profile explicit
- the remaining work here is readability and emphasis polishing, not a contract blocker

Scope:

- [README.md](/home/tmdduq96kr/projects/rebel-ai/README.md)
- [docs/HOSTING_PROFILES.md](../HOSTING_PROFILES.md)
- [docs/OPERATING_PLAN.md](../OPERATING_PLAN.md)

Why:

- the current docs are much better than before, but they still carry enough dual-profile language to invite “both are first-class” drift
- this is a lower-priority clarity issue, not a blocker, because the operating plan already states the intended boundary

Done when:

- the repo has one obvious day-to-day operating profile for current work
- future public-serving language is kept clearly separate from current default operation
- new contributors do not have to infer which profile should drive verification decisions

## Deferred Until the Operating Contract Changes

These are real future tasks, but they should not dilute this backlog while the current contract remains a closed personal deployment:

- broad public-opening work
- new optional async features that do not harden the supported core
- alternate storage backend expansion
- generic whole-repo cleanup that is not tied to a concrete risk boundary from the audit
