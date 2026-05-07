# Memory Structure Inspector Backlog

Created: 2026-05-08

This is the execution backlog for reshaping the dashboard memory panel around
the current long-term memory doctrine.

The working direction is:

- treat `prefix_live_blocks + summaries + ATR` as the first-class long-chat
  path
- keep `summary_window` as maintained legacy compatibility unless a later
  policy decision retires it
- change the dashboard memory panel from a context-preview surface into a
  memory-structure inspector

This backlog is intentionally split into multiple sessions. Do not try to land
all of it in one change.

## Current Problem

The dashboard summary panel still behaves like a preview of summaries that are
eligible for the current prompt context. That was useful for the older
`summary_window` mental model, but it is increasingly awkward for
`prefix_live_blocks`.

In particular:

- the loader already fetches all summary rows, but the panel filters them back
  down to context-visible summaries
- chunk summaries covered by meta summaries are hidden instead of inspectable
- `prefix_live_blocks` has rollover behavior where older meta summaries can
  replace chunks, while the current meta window may still keep chunks in the
  prompt
- the UI does not make clear whether a row is currently in prompt context,
  covered by a higher-level summary, outside the raw tail, or simply stored for
  inspection

This makes the panel hard to reason about when chats have many canonical chunks
and higher-level summaries.

## Product Decision Snapshot

For this backlog, assume:

- `prefix_live_blocks` is the design center for new memory UI work
- `summary_window` remains supported but should not force the new UI into the
  old context-preview model
- stored summaries should be inspectable even when they are not currently
  included in prompt context
- status should be shown as metadata, not encoded by hiding rows

Do not remove `summary_window` as part of this backlog unless a separate policy
decision explicitly approves that migration/removal.

## Non-Goals

- removing `summary_window`
- changing summary generation semantics
- changing the sealed-memory writer
- changing ATR retrieval contracts
- adding a new memory artifact type
- implementing lazy loading before the tree data model is settled
- changing database schema

## Open Decisions

These should be decided before or during the relevant implementation phase:

- should new chats default to `prefix_live_blocks` everywhere, or is that
  already sufficiently true through current config defaults?
- should `summary_window` remain visible in settings, be labeled legacy, or be
  hidden for new chats?
- should the memory panel keep any explicit "context preview" section, or only
  show context status badges inside the inspector?
- when lazy loading is introduced, should initial load include:
  - only counts and high-level ranges,
  - all meta summaries but lazy child chunks,
  - or even meta summaries lazily by range/page?
- should facts be displayed as a separate paginated/lazy section, or remain
  eager until fact volume proves problematic?

## Proposed End State

The memory panel becomes a structural inspector:

```text
Long-term Memory

Current mode: Prefix
Raw tail: latest 4 messages
Sealed through: 230

Meta Summary 1-100        In prompt
  Chunk Summary 1-10      Covered
  Chunk Summary 11-20     Covered
  ...

Meta Summary 101-200      Stored
  Chunk Summary 101-110   In prompt
  ...
  Chunk Summary 191-200   In prompt

Loose Chunks
  Chunk Summary 201-210   In prompt
  Chunk Summary 211-220   In prompt
  Chunk Summary 221-230   In prompt
```

Exact status labels may change, but the important shift is:

- rows are not hidden merely because they are covered
- parent/child relationships are visible
- prompt inclusion is a badge/status, not the whole display filter

## Session Plan

### Session 1: Confirm Memory Policy

Goal: make the operating policy explicit before touching UI behavior.

Tasks:

- verify current defaults in `src/lib/chat/model-config.ts` and chat creation
  paths
- confirm whether `prefix_live_blocks` is already the effective default for new
  chats
- decide whether settings copy should label `summary_window` as legacy
- update docs only if the current doctrine is stale

Acceptance:

- the next implementer can say which mode is first-class
- no UI tree work is blocked by ambiguity about `summary_window`

### Session 2: Define Inspector Data Model

Goal: design a pure in-memory model before changing rendering.

Tasks:

- add or sketch a helper that groups `SummaryEntry[]` into:
  - meta summary nodes
  - child chunk nodes
  - loose chunk nodes
  - optional super-meta nodes if policy later re-enables them
- compute status metadata separately from grouping
- cover representative ranges in focused tests

Suggested file options:

- `src/app/dashboard/chats/[id]/summary-structure.ts`
- or a narrower helper next to `ChatSummariesPanel.tsx`

Acceptance:

- grouping can be tested without rendering React
- the helper can explain a 250-message case without needing component state

### Session 3: Render Tree With Existing Eager Data

Goal: change the UI shape while keeping the current server loading strategy.

Tasks:

- keep `ChatSummariesPanelLoader` eager for now
- replace separate meta/chunk visibility sections with an inspector tree
- add per-row badges for context/storage status
- preserve edit, delete, regenerate, and fallback badges
- keep sections collapsed by default

Acceptance:

- all stored summary rows remain reachable from the panel
- context-visible rows are clearly marked
- covered child chunks can be inspected by expanding their parent

### Session 4: Align Prefix Rollover Status

Goal: make status badges match `prefix_live_blocks` context behavior.

Tasks:

- mirror the rollover rule from `src/lib/chat-memory/prefix-live-blocks.ts`
  without duplicating fragile logic more than necessary
- distinguish at least:
  - in prompt
  - covered by higher-level summary
  - stored child of current meta range
  - raw tail / too recent
- add tests based on the existing rollover case in
  `src/lib/chat-memory/prefix-live-blocks.test.ts`

Acceptance:

- the 1-100 meta / 101-200 current chunks scenario displays correctly
- the panel does not imply that a hidden meta row is lost or invalid

### Session 5: Decide Lazy Loading Policy

Goal: decide the loading boundary after the tree model exists.

Policy options:

- eager meta summaries, lazy child chunks
- eager ranges/counts only, lazy meta and chunks
- keep summaries eager, lazy facts only
- defer lazy loading if measured volume does not justify added complexity

Questions:

- what does the initial panel need to render useful collapsed headers?
- should meta summary text be fetched immediately, or only on expand?
- should child counts be exact from the initial query or loaded on demand?
- how does realtime update interact with lazy-loaded children?

Acceptance:

- one loading policy is chosen and documented
- API/server-action boundaries are sketched before implementation

### Session 6: Implement Lazy Loading If Approved

Goal: reduce initial memory panel payload without weakening inspectability.

Tasks:

- add focused API/server-action fetches for summary children or pages
- add loading and error states per expanded node
- avoid fetching rows the user never opens
- preserve mutation flows for edit/delete/regenerate
- add tests for fetch shape and UI state

Acceptance:

- opening a parent fetches only the needed child range/page
- initial panel render no longer requires all child rows if the selected policy
  says so

### Session 7: Legacy Cleanup Pass

Goal: keep `summary_window` compatibility deliberate and bounded.

Tasks:

- review settings UI copy
- review tests that assume `summary_window` is the primary path
- remove or relabel obsolete context-preview copy
- park any full `summary_window` retirement work in a separate backlog

Acceptance:

- legacy support is explicit rather than accidental
- no first-class UI concept is named after the old summary-window behavior

## Suggested ATD-Friendly Slices

Use these as smaller tutoring sessions:

- explain `summaryCutoff` in `ChatSummariesPanel.tsx`
- explain `filterRedundantChunks` in `context-builder.ts`
- trace the rollover test in `prefix-live-blocks.test.ts`
- write one pure helper test for "meta contains chunks"
- add one status badge without changing tree structure
- rename one UI label from context-preview language to inspector language

## Verification Guidance

For implementation sessions, run focused tests first:

```sh
npm run test -- src/app/dashboard/chats/[id]/ChatSummariesPanel.test.tsx
npm run test -- src/app/dashboard/chats/[id]/components/MemorySections.test.tsx
npm run test -- src/lib/chat-memory/prefix-live-blocks.test.ts
```

Broader checks before closing a multi-file UI change:

```sh
npm run lint
npx tsc --noEmit
```

This backlog is UI/policy oriented. It does not require `npm run ops:smoke`
unless a later implementation changes internal routes, runner behavior, trigger
wiring, janitors, deployment assumptions, or environment-variable contracts.
