# Support Boundaries

This document is a stable engineering doctrine for RebelAI.
It defines how support status and trust boundaries interact.
It should change only when the philosophy changes, not when individual features move between statuses.

For current operating defaults, see [OPERATING_PLAN.md](./OPERATING_PLAN.md).
For live feature assignments in code, see [support-tier.ts](../src/lib/support-tier.ts).

## 1. Two Axes, Not One

RebelAI uses two separate axes:

- **Support status** answers: how strongly is this path supported day to day?
- **Trust boundary** answers: what is this path allowed to touch?

`experimental` is a support label.
Safe experimentation comes from boundary design, not from the label itself.

## 2. Support Statuses

### Core

- Part of the maintained first-class path.
- Failures here directly threaten normal operation.
- Requires strong regression coverage, operator visibility, and release discipline.

### Fallback

- Not the main path, but still maintained because it supports the active operating contract.
- Failures must remain visible and actionable.
- This is not an experiment and should not be treated as disposable.

### Experimental

- Useful for iteration, but not part of the day-to-day support promise.
- Must not weaken core or fallback behavior.
- Should be easy to disable, isolate, or revert.

### Removal

- Legacy or transition-only behavior.
- No new product investment.
- Isolate first, then remove when safe.

## 3. Experimental Contract

An experimental path should follow these defaults whenever practical:

- default **off** or otherwise isolated from the normal path
- explicit opt-in when user-facing
- easy to disable without data repair
- separate state or settings from the supported core when practical
- failure must not change core request acceptance, durable state, or permission outcomes
- prefer non-blocking dispatch from core paths instead of direct synchronous coupling

## 4. Forbidden Zones For Experimental Paths

Experimental paths must not directly own or redefine:

- authentication, session issuance, or permission checks
- Vault or API key secret ownership and write boundaries
- internal runner or trigger authorization
- destructive multi-step writes that can leave partial durable state behind
- billing, quotas, credits, or cost commitments
- raw HTML, script execution, or equivalent arbitrary execution surfaces

If a feature needs one of these, it is no longer "just experimental."
It must either move behind an already-hardened core boundary or be redesigned.

## 5. Approval Rule For Fast Experiments

A path is safe to ship as experimental only when all of these are true:

- it does not cross a forbidden zone
- disabling it returns the system to the supported path without repair work
- its failure cannot break core acceptance, durable state, or user trust
- operators can still see failure through lightweight logs, triage, or other bounded signals

## 6. Division Of Responsibility

This split is intentional:

- [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md): stable doctrine
- [OPERATING_PLAN.md](./OPERATING_PLAN.md): current operating mode, defaults, and gates
- [support-tier.ts](../src/lib/support-tier.ts): live feature-to-status assignments in code

Philosophy should change rarely.
Assignments and operating choices can change with the codebase.
