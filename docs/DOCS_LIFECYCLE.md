# Docs Lifecycle

Created: 2026-07-04
Status: Active
Role: Contract
Last reviewed: 2026-07-04
Source of truth: `docs/README.md` plus the current docs tree
Revisit when: docs roles become unclear, major product mode changes, or docs cleanup starts

This document defines how RebelAI documentation should declare its role, remain
findable, and age without turning into accidental product contract.

It does not replace code, tests, migrations, generated types, or the active
deployment as the exact source of truth.

## Why This Exists

RebelAI has several kinds of docs:

- active operating doctrine
- runbooks used during real work
- maps that help humans and agents orient themselves
- historical design notes
- reviews and evidence logs
- execution backlogs

The risk is not having many docs. The risk is letting active doctrine,
historical notes, and one-off analysis sit at the same trust level.

## Roles

Use one of these roles when classifying a document.

### Contract

Current doctrine, policy, or workflow that maintainers should follow.

Examples:

- product identity and support boundaries
- current operating mode
- database workflow
- provider/runtime boundary contracts

If code disagrees with an active contract doc, either the code or the doc is
drifting and should be reconciled.

### Runbook

Step-by-step operating instructions for a real task.

Examples:

- getting started
- smoke checks
- maintainer import flows

Runbooks should stay short, executable, and close to the commands they mention.

### Map

Orientation material that explains where important behavior lives.

Examples:

- first-class path map
- LLM invocation ownership
- feature burden inventory

Maps are allowed to summarize, but they should not silently become the exact
runtime contract.

### Reference

Helpful background for a stable subject where exact behavior lives elsewhere.

Examples:

- format notes whose schema truth lives in code
- authoring guides
- schema overviews whose exact truth lives in migrations and generated types

### Working Note

Design notes, transition notes, or exploratory plans that may still be useful
but are not current policy.

Working notes should not be used as the default source for implementation
unless they are promoted into an active backlog or contract doc.

### Evidence

Review outputs, audit notes, and decision records.

Evidence can justify later work, but it is not itself an active instruction
unless copied into a contract, runbook, map, or backlog.

### Backlog

Execution queue for planned work.

Backlogs have their own lifecycle in `docs/backlogs/README.md`: active, parked,
and archive.

## Statuses

Use these statuses when a document needs an explicit lifecycle marker.

- `Active`: expected to be consulted for current work
- `Needs Review`: useful, but likely stale or not fully reconciled with current
  code
- `Parked`: intentionally deferred; preserve, but do not treat as active
- `Superseded`: replaced by a newer doc or code path; preserve only for history
- `Archived`: historical record only

## Header Convention

For new or substantially edited docs, prefer this short header after the title:

```md
Status: Active
Role: Contract
Last reviewed: 2026-07-04
Source of truth: code/tests/migrations/...
Revisit when: ...
```

Use the header when it prevents ambiguity. Do not churn old docs only to add
metadata unless the doc is being touched for real work.

## Maintenance Rules

1. Every new docs file should have a clear role, either in its own header or in
   `docs/README.md`.
2. If a document says "current", "active", "default", "contract", or
   "first-class", it should be listed in `docs/README.md`.
3. Working notes must not override active contract docs.
4. When implementation changes a contract, update the smallest active doc that
   carries that contract.
5. When a working note becomes actionable, promote it into a backlog or fold its
   decision into an active contract/map.
6. Prefer marking docs as `Needs Review`, `Parked`, or `Superseded` before
   deleting them.
7. Reviews and evidence logs should stay in `docs/reviews/` unless their
   recommendations become active work.

## Suggested Review Loop

Use this lightweight loop when docs feel stale:

1. Start from `docs/README.md`.
2. Check whether the doc is contract, runbook, map, reference, working note,
   evidence, or backlog.
3. If the role is unclear, mark it `Needs Review` or reclassify it in the docs
   map.
4. If the doc is active, compare it against code/tests/migrations before making
   a product decision from it.
5. If the doc is no longer active but still useful, leave it as working note,
   evidence, parked, or superseded.

## First Cleanup Policy

Do not start with mass moves or deletions.

The first cleanup pass should:

- make `docs/README.md` role-aware
- add lifecycle headers only to docs already being touched
- move clearly obsolete files only after a replacement is named
- keep backlogs under their existing active/parked/archive structure

This keeps documentation cleanup from becoming its own risky migration.
