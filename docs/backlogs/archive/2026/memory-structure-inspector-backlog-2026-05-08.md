# Memory Structure Inspector Backlog

Created: 2026-05-08
Updated: 2026-06-28
Status: Complete — ready to archive after the final copy change is committed

This is the execution backlog for reshaping the dashboard memory panel around
the current long-term memory doctrine.

The working direction is:

- treat `prefix_live_blocks + summaries + ATR` as the first-class long-chat
  path
- keep `summary_window` as a maintained compatibility fallback unless a later
  policy decision retires it
- change the dashboard memory panel from a context-preview surface into a
  memory-structure inspector

This backlog is intentionally split into multiple sessions. Do not try to land
all of it in one change.

## 2026-06-28 Progress Update

The core inspector work is complete:

- the Prefix prompt-selection rule now lives in a shared, client-safe pure
  module instead of being duplicated between runtime and UI
- all stored meta and chunk summaries remain reachable from the panel
- the dashboard renders one `Summary Structure` tree with meta parents,
  expandable child chunks, and a separate loose-chunk group
- summary rows display mutually exclusive `In prompt`, `Covered`, or `Stored`
  badges in Prefix mode
- edit, delete, regenerate, fallback, and collapsed-section behavior remain
  available
- the 250-message rollover case is covered across grouping, prompt selection,
  status calculation, rendering, and child expansion tests

Relevant delivery commits:

- `5b9886b` `Extract prefix summary selection policy`
- `aba96fa` `Add summary prompt status model`
- `6974977` `Show prefix prompt status badges`
- `881533e` `Fix client-safe summary selection boundary`
- `8399f99` `Show all stored memory summaries`
- `318ba25` `Render summary memory as inspector tree`
- `de237b9` `Show stored and covered memory statuses`
- `abf3d89` `Cover 250-message inspector rollover`

The implementation and policy decisions are complete:

- lazy loading is deferred until measured summary or fact volume justifies its
  additional API, loading-state, and realtime complexity
- regular-user memory labels remain neutral (`Summary` and `Prefix`), while
  developer labels retain the explicit `fallback` and `core` support tiers
- `summary_window` remains a named compatibility mode and is not presented as
  `Legacy` in user-facing copy
- full retirement or hiding of `summary_window` belongs in a separate backlog

## Original Problem

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

## Resolved Decisions

- `prefix_live_blocks` is the maintainer/operator first-class mode; the generic
  compatibility default remains `summary_window` for now
- `summary_window` remains visible and maintained as fallback compatibility; it
  is not removed by this backlog
- the inspector does not keep a separate context-preview section; row badges
  communicate prompt-selection status
- status badges describe the summary artifact itself, not every representation
  of its source range; a `Stored` summary can overlap messages that are still
  present as live/raw transcript
- the core inspector keeps the existing eager loader until measured volume
  justifies a more complex loading boundary
- regular-user settings use neutral `Summary` and `Prefix` labels rather than
  claiming that either mode is the universal default
- developer settings keep `Summary fallback` and `Prefix core`, while
  user-facing copy does not label the maintained `summary_window` mode as
  `Legacy`
- the `Summary Window` and `Prefix` panel names remain because they identify
  supported modes rather than obsolete UI concepts

## Deferred Follow-up Decisions

These are not blockers for this backlog. Revisit them only after measured data
volume or latency demonstrates a need for lazy loading:

- if lazy loading is introduced later, should initial load include:
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
  Chunk Summary 201-210   Stored
  Chunk Summary 211-220   Stored
  Chunk Summary 221-230   Stored
```

The loose-chunk labels above describe whether each summary artifact is selected
for the prompt. Its underlying source messages may still be present in the
live/raw transcript.

Exact status labels may change, but the important shift is:

- rows are not hidden merely because they are covered
- parent/child relationships are visible
- prompt inclusion is a badge/status, not the whole display filter

## Session Plan

### Session 1: Confirm Memory Policy

Status: Completed.

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

Status: Completed.

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

Status: Completed on 2026-06-28.

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

Status: Completed on 2026-06-28.

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

Status: Completed on 2026-06-28. Lazy loading is deferred until measured volume
justifies the added complexity.

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

Status: Skipped. Session 5 chose to retain eager loading for now.

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

Status: Completed on 2026-06-28.

Goal: keep `summary_window` compatibility deliberate and bounded.

Tasks:

- review settings UI copy
- review tests that assume `summary_window` is the primary path
- remove or relabel obsolete context-preview copy
- park any full `summary_window` retirement work in a separate backlog

Acceptance:

- compatibility support is explicit rather than accidental
- regular-user copy does not misidentify Prefix as the universal default
- `Summary Window` appears only as the name of the maintained compatibility
  mode, not as the organizing concept for the Prefix-first inspector

## Completed ATD-Friendly Slices

The 2026-06-28 tutoring sessions covered:

- explain `summaryCutoff` in `ChatSummariesPanel.tsx`
- extract the prompt-selection rule and move its shared filter into a
  client-safe pure module
- trace the rollover test in `prefix-live-blocks.test.ts`
- write one pure helper test for "meta contains chunks"
- add prompt, covered, and stored status badges
- replace context-preview filtering with an inspector tree

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
