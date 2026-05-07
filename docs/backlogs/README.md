# Backlogs

This directory is an execution queue, not a document dump.

Use it to answer two questions quickly:

- what should I work from now
- where did older backlog docs go

## Structure

- [active/](./active): current execution backlogs, if any
- [parked/2026/](./parked/2026): intentionally deferred backlog snapshots that may
  return later
- [archive/2026/](./archive/2026): completed or superseded backlog snapshots from
  2026

## Current Entry Point

- Active backlog:
  [memory-structure-inspector-backlog-2026-05-08.md](./active/memory-structure-inspector-backlog-2026-05-08.md)
- Most recently parked backlog:
  [explicit-memory-v0-backlog-2026-04-22.md](./parked/2026/explicit-memory-v0-backlog-2026-04-22.md)
- Most recently archived backlog:
  [suu-host-overflow-backlog-2026-04-25.md](./archive/2026/suu-host-overflow-backlog-2026-04-25.md)

## Working Rules

- Prefer one active backlog at a time unless the operating contract changes.
- Move a backlog to `parked/` when it is intentionally deferred.
- Move a backlog to `archive/` when it is completed or replaced.
- Keep policy and direction docs in `docs/`, not in `docs/backlogs/`.
- Parked and archive docs are historical context, not the default source for the
  next work session.
