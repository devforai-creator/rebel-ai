# SUU Host Overflow Escape Hatch Backlog

Updated: 2026-05-03
Status: Active (P0-5 completed via hostOverflow=auto, P0-6 pending)

Parking note:

- drafted on `2026-04-25` after diagnosing a mobile viewport overflow caused by
  an `image_display` SUU card with hardcoded `width: "30em"` in the
  `*** combined.rbx` package
- briefly parked on `2026-04-25` because this work is opt-in defense for an
  issue that is originally the RBX/SUU card author's responsibility, not a
  regression in RebelAI itself, so SLA is loose
- unparked on `2026-04-25` immediately after parking for tutoring-mode pickup;
  the maintainer wanted to start the implementation right away
- being executed in **tutoring mode**: the maintainer types the implementation,
  AI gives hints/review only, then the diff goes through external code review
  (Codex) before merging
- on `2026-05-03`, runtime DOM measurement during P0-5 execution falsified the
  prescribed shape: the user-visible viewport bug was a separate `min-w-0` flex
  cascade issue at `page.tsx:189`, fixed in a one-line commit independent of
  SUU. The wrapper + `hostOverflow="visible"` change had zero user-visible
  effect because `contain: paint` on the SUU container clips wide cards
  regardless of `overflow`. See "## 2026-05-03 Update" section for the full
  finding.
- on `2026-05-03` (follow-up, same day), tested the untried `hostOverflow="auto"`
  permutation. Result: SUU container becomes its own scroll container, sidestepping
  the `contain: paint` clip. P0-5 closed with `hostOverflow="auto"` at both call
  sites, no host wrapper. The `hostOverflow` API is justified — the prescription
  just used the wrong value.

## 2026-05-03 Update — Hypothesis Falsified By Measurement

While executing P0-5 in tutoring mode, the maintainer applied the prescribed
wrapper + `hostOverflow="visible"` exactly as specified, but runtime DOM
measurement on a viewport ≈ 452px showed:

- bubble width 483px (still overflowed viewport)
- wrapper `scrollWidth` 449px (no horizontal scroll triggered)
- card intrinsic width 480px (`width: 30em`) but visually clipped to wrapper
  width

A diagnostic walked the parent chain from the wrapper upward and located the
actual cascade break: `src/app/dashboard/chats/[id]/page.tsx:189` had
`min-h-0` but was missing `min-w-0`. With `min-width: auto` defaulting on the
flex item, the chain could not propagate the viewport constraint when wide
content was inside.

Adding `min-w-0` at that single site fixed the bubble overflow and text
word-wrap. The wrapper + `hostOverflow="visible"` change in
`message-renderer.tsx` had zero user-visible effect, before or after the
cascade fix.

### Why the prescription was insufficient

The prescription assumed `hostOverflow="visible"` + a host-side
`overflow-x: auto` wrapper would produce local horizontal scroll for
oversized cards. Two CSS containment behaviors break this:

- `contain: layout` on the SUU container hides inner overflow from the
  wrapper's `scrollWidth` calculation, so the wrapper does not see the 480px
  card and never triggers `overflow-x: auto`
- `contain: paint` clips painting to the SUU container's own box regardless
  of the `overflow` value, so the card's right side is silently invisible
  even when `overflow: visible` is set

The current `@safe-ugc-ui/react@3.0.0` `hostOverflow` prop only unlocks the
`overflow` key. `contain` defaults remain locked
(`node_modules/@safe-ugc-ui/react/dist/index.js:12`,
`node_modules/@safe-ugc-ui/react/dist/index.d.ts:51`). So the prescribed
shape cannot deliver the third acceptance note (card reachable via
horizontal scroll) on the current SUU API surface.

### Decisions

- `page.tsx` `min-w-0` shipped as a separate commit (`Fix mobile bubble
overflow with min-w-0 on chat flex container`); this is the actual
  user-visible fix and is independent of SUU.
- The `message-renderer.tsx` wrapper + `hostOverflow="visible"` change is
  reverted. It has no user-visible effect on the current SUU API and would
  need a different shape if/when SUU exposes a paint hatch. Re-introducing
  it is trivial when that arrives.
- SUU 3.0.0 stays. The `hostOverflow` API is not wrong (it does unlock
  `overflow` exactly as documented). It is just insufficient alone for the
  wide-card paint case.
- The wide-card paint clip remains an open issue. See "Deferred For Later"
  for the recommended next path (RBX import-side width normalization).

### Acceptance criteria revisited

| Original P0-5 acceptance note                | Outcome                                          |
| -------------------------------------------- | ------------------------------------------------ |
| bubble does not push past viewport on mobile | met by `page.tsx` min-w-0 fix, not by SUU change |
| text in same bubble word-wraps normally      | met by `page.tsx` fix (same root cause)          |
| card reachable via local horizontal scroll   | NOT met. `contain: paint` still clips. open.     |
| smaller-than-viewport card unchanged         | trivially met (wrapper reverted)                 |

### Status updates

- P0-5: rejected. Prescribed change reverted from RebelAI; actual fix landed
  at `page.tsx:189` (separate commit).
- P0-6: deferred. The smoke check would only assert wrapper presence, but
  the wrapper is reverted. Re-scope when paint hatch direction is decided.

### Meta lesson

Runtime DOM measurement on the first day of execution would have surfaced
both the cascade break and the paint clip immediately, instead of after a
week of SUU API + release flow work. Future backlogs of this shape (host
absorbs untrusted-content overflow) should include a small measurement step
before locking in the prescription.

### Follow-up: hostOverflow=auto closes P0-5

After the revert and the cascade-fix commit, a quick test of the untried
`hostOverflow="auto"` permutation was run on the same viewport. Result:
the SUU container becomes its own scroll container and the wide card is
reachable via touch / wheel pan inside the card area. No host wrapper is
needed.

Why `"auto"` works where `"visible"` did not:

- `overflow: visible` tells the container to render content outside its
  box; `contain: paint` then forbids that painting, so the card is
  silently clipped
- `overflow: auto` keeps the scroll inside the container's box, so
  `contain: paint` does not conflict — what is painted at any scroll
  offset stays within the box

Decision update:

- P0-5 closed with `hostOverflow="auto"` at both call sites in
  `message-renderer.tsx`; no wrapper. Commit: `Enable in-card scroll for
wide SUU cards via hostOverflow=auto`.
- The earlier "revert and consider removing the prop" path is no longer
  pursued. The `hostOverflow` API is justified — it just needed the right
  value.
- `page.tsx` `min-w-0` fix remains a separate, independent layout fix and
  is still valid on its own.

Updated acceptance criteria:

| Original P0-5 acceptance note                | Outcome                                                              |
| -------------------------------------------- | -------------------------------------------------------------------- |
| bubble does not push past viewport on mobile | met by `page.tsx` min-w-0 fix                                        |
| text in same bubble word-wraps normally      | met by `page.tsx` fix                                                |
| card reachable via local horizontal scroll   | met by `hostOverflow="auto"` (scroll inside SUU container, not host) |
| smaller-than-viewport card unchanged         | trivially met                                                        |

Updated status:

- P0-5: **completed** (2026-05-03)
- P0-6: re-opened to `pending`. Smoke check should now assert
  `hostOverflow="auto"` prop presence at both call sites.
- Deferred-for-later RBX import normalization: still good defensive hygiene
  for cards that hardcode unreasonable widths, but no longer blocking the
  user-visible bug.

### Second meta lesson

The first prescription used `hostOverflow="visible"` because the backlog
author imagined the host wrapper as the scroll container. The simpler shape
(`hostOverflow="auto"`, no wrapper) was not even on the considered-alternatives
table. Future backlogs that gate behavior on a small enum prop should
explicitly enumerate the prop's values and reason about each one before
choosing — the unconsidered value can be the right one.

---

This document is the execution backlog draft for adding a narrow
host-controlled escape hatch to the SUU `UGCContainer` so that RebelAI can
absorb mobile viewport overflow caused by SUU cards that did not consider
mobile width during authoring.

This queue answers two narrower questions:

- how to allow a host (RebelAI) to opt in to horizontal scroll handling for
  oversized SUU cards without weakening SUU's untrusted-content isolation model
- where to place the wrapper that catches the overflow on the host side so
  authored card width never escapes the message bubble into the page viewport

It is not:

- a license to relax SUU's `isolation` / `contain` / `position` defaults
- a way for the card author (untrusted) to control container overflow from
  inside the card JSON
- a substitute for telling RBX/SUU authors to design mobile-aware cards in the
  first place
- a general "make any oversized SUU node fit any viewport" auto-resize feature

## Working Rules

- The only protected isolation key that becomes host-controllable is
  `overflow`. `isolation`, `contain`, and `position` stay locked.
- The escape hatch is exposed as a dedicated SUU prop, not as a relaxation of
  the existing `containerStyle` merge order. Card-author input must remain
  unable to reach the protected key path.
- Default behavior is unchanged. The new prop must be opt-in and
  backwards-compatible.
- When a host opts in, it must pair the SUU change with a host-side wrapper
  that prevents the unlocked overflow from breaking the page viewport.
- Ship the SUU change with explicit tests that prove `containerStyle.overflow`
  is still ignored, and that the new prop is the only legal channel.

## Why This Queue Exists

Mobile users hitting a `*** combined.rbx`-style card see the entire
message bubble blow past the viewport. Text in the same bubble gets clipped
because `break-words` cannot rescue a parent that has already been stretched
by a sibling SUU card with intrinsic `width: 30em` (~480px).

Diagnosis confirmed:

- the SUU `UGCContainer` already applies `overflow: hidden` /
  `isolation: isolate` / `contain: content` / `position: relative` defaults
  (`@safe-ugc-ui/react/dist/index.js:12-21`)
- `contain: content` does not include size containment, so a child width can
  still stretch the container's intrinsic size
- the existing message-bubble parent (`MessageBubble.tsx:119`) has
  `max-w-full overflow-x-auto`, but the SUU container's stretched width
  defeats that constraint upstream

Two render call sites are affected:

- `src/app/dashboard/chats/[id]/utils/message-renderer.tsx:340-348`
  (inline `ui_card`)
- `src/app/dashboard/chats/[id]/utils/message-renderer.tsx:444-451`
  (`image_display` inside `ImageDisplayErrorBoundary`)

Originally the card author owns this. RebelAI is volunteering to take a
narrow share of the responsibility so end users on mobile do not see broken
viewports while still relying on author goodwill for the rest of the design.

## Considered Alternatives

The chosen direction is option **B-1 (host-controlled overflow prop)**. The
others were considered and rejected for the reasons below.

| Option                                             | Why not chosen                                                                                                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — RebelAI-only wrapper, no SUU change**        | The SUU container's intrinsic stretch behavior defeats any pure-host wrapper. Card content gets visually clipped at the SUU layer regardless.                                                                                       |
| **B-2 — flip `containerStyle` merge order in SUU** | Breaks SUU's protected isolation contract documented in `SUU/CLAUDE.md:97`. Lets card-author input reach protected keys via any host that builds `containerStyle` from card metadata.                                               |
| **B-3 — RebelAI-side `transform: scale()` trick**  | No SUU change, but breaks hover/click coordinates and is implicit magic that is hard to debug.                                                                                                                                      |
| **C — make SUU auto-handle mobile internally**     | Pushes UX policy ("how to handle oversized cards on mobile") into SUU. Other future hosts (dashboards, fullscreen viewers) might want different policies (auto-shrink, modal expand, etc.). Increases SUU's responsibility surface. |

## Chosen Shape

### SUU API Change

Add a new prop on `UGCRenderer` (and pass it through to `UGCContainer`):

```ts
interface UGCRendererProps {
  // existing
  containerStyle?: React.CSSProperties

  // new
  hostOverflow?: 'hidden' | 'visible' | 'auto' | 'scroll' // default: 'hidden'
}
```

Container style merge becomes:

```ts
const mergedStyle = {
  ...style, // user containerStyle (lowest priority)
  ...DEFAULT_PROTECTED_STYLES, // isolation/contain/position/overflow defaults
  ...(hostOverflow // host explicit overflow override (highest)
    ? { overflow: hostOverflow }
    : {}),
}
```

Key invariants:

- only `overflow` becomes host-overridable
- `isolation`, `contain`, `position` remain protected and not overridable
- `containerStyle.overflow` is still ignored (existing protection preserved)
- `hostOverflow` is the only legal channel to change container overflow

### RebelAI Side

In `src/app/dashboard/chats/[id]/utils/message-renderer.tsx`, wrap each
`UGCRenderer` call site in a host-controlled scroll container, and pass the
new prop:

```tsx
<div style={{ maxWidth: '100%', overflowX: 'auto' }}>
  <UGCRenderer
    card={...}
    hostOverflow="visible"
    {...rest}
  />
</div>
```

The outer wrapper enforces viewport safety. The SUU container's relaxed
overflow lets the oversized child be visible inside the wrapper, where the
wrapper's own `overflow-x: auto` turns it into local horizontal scroll. The
message bubble itself stays inside the viewport.

## P0 Execution Order

### P0-1. Add `hostOverflow` Prop In SUU

Status: `completed` (2026-04-25, SUU 70636e5)

Primary scope:

- type addition in `packages/react/src` (UGCRenderer props + container style
  merge)
- pass-through plumbing from `UGCRenderer` into `UGCContainer`

Acceptance notes:

- default behavior is unchanged when the prop is absent
- the prop accepts `'hidden' | 'visible' | 'auto' | 'scroll'` only

### P0-2. Add Tests Proving Isolation Stays Locked

Status: `completed` (2026-04-26, SUU 74c6080)

Primary scope:

- `containerStyle.overflow` is still ignored
- `containerStyle.isolation` / `contain` / `position` are still ignored
- only `hostOverflow` flips the rendered container's `overflow` style
- absent prop renders identical DOM to current behavior

Acceptance notes:

- tests live next to the SUU renderer source
- tests cover both renderer-level prop pass-through and container-level merge
  outcome

### P0-3. Update SUU Spec And Docs

Status: `completed` (2026-04-28, SUU 9ddbfb5)

Primary scope:

- `safe-ugc-ui-card-spec.md` mention of the new host prop and its boundary
- `SUU/CLAUDE.md:97` line stays accurate: only `overflow` may be host-overridden
  via the new prop, other isolation keys remain protected
- README mention of the new prop on the public package

Acceptance notes:

- doc explicitly states the host wrapper requirement when the prop is used

### P0-4. Build And Bump SUU

Status: `completed` (2026-04-29, SUU 31f2af7)

Primary scope:

- `pnpm build` workspace-wide
- patch or minor version bump on `@safe-ugc-ui/react`
- regenerate types if needed

Acceptance notes:

- `pnpm release:check` passes

### P0-5. Apply Wrapper And Prop In RebelAI

Status: `completed` (2026-05-03, via `hostOverflow="auto"` instead of the
originally prescribed wrapper + `"visible"`)

Originally specified scope:

- update `message-renderer.tsx` two call sites to wrap `UGCRenderer` and pass
  `hostOverflow="visible"`
- bump `@safe-ugc-ui/react` dependency in RebelAI `package.json`

Final implemented scope:

- `package.json` bumped to `@safe-ugc-ui/react@3.0.0` (commit `abadae2`,
  2026-04-29)
- `message-renderer.tsx` two call sites pass `hostOverflow="auto"`. No host
  wrapper. (commit `Enable in-card scroll for wide SUU cards via
hostOverflow=auto`, 2026-05-03)
- separate independent layout fix: `min-w-0` added to
  `src/app/dashboard/chats/[id]/page.tsx:189` (commit `Fix mobile bubble
overflow with min-w-0 on chat flex container`, 2026-05-03)

Why the prescription changed: see "## 2026-05-03 Update" above. Short
version — `"visible"` plus a host wrapper was insufficient because
`contain: paint` clipped the wide card regardless. `"auto"` keeps the
scroll inside the SUU container's own box, where `contain: paint` does
not conflict.

### P0-6. Add A Smoke Or Visual Check

Status: `pending` (re-opened 2026-05-03 after P0-5 closed via `auto`)

Primary scope (revised):

- minimal regression coverage that asserts `hostOverflow="auto"` is passed
  to both `UGCRenderer` call sites in `message-renderer.tsx`
- if a future refactor removes the prop or flips it back to `"visible"`,
  the test fails loudly

Acceptance notes:

- assertion is on the prop value at the render call sites, not on rendered
  DOM (since SUU itself owns the rendered container behavior)
- can be co-located with the existing `message-renderer.test.tsx`

## Tutoring Mode Notes

This backlog is tagged for tutoring mode. When picked up:

- the maintainer types the implementation; AI provides hints, reviews diffs,
  and answers conceptual questions only
- after the maintainer finishes the implementation locally, send the diff
  through Codex code review before merging
- record three things learned at the end of the session (per maintainer's
  AI-tutored dev memory rule)

Concept areas this task is good for practicing:

- protected style escape hatch design (host-controlled prop vs untrusted user
  style)
- CSS containment semantics (`contain: content` does not include size
  containment, so child width can stretch parent intrinsic size)
- multi-package workspace flow: change in `SUU/`, build, bump, then consume
  from `RebelAI/`
- writing tests that assert a security policy stays in place after a feature
  addition

## Deferred For Later

- a richer SUU prop family for other isolation keys (no current motivation,
  YAGNI). Note as of 2026-05-03 there is now a known motivation: the
  wide-card paint clip case requires a `contain` override channel. This is
  still deferred because exposing `contain` overrides reopens the SUU
  isolation contract and needs a separate threat model before any API
  shape is chosen.
- automatic mobile detection inside SUU (rejected by design — UX policy lives
  in the host)
- normalization of card-author width units inside RebelAI's import path (could
  be a separate, future backlog if RBX import ever needs to defensively rewrite
  hardcoded `em`/`px` widths). Status as of 2026-05-03 (after `auto`
  follow-up): no longer urgent — the user-visible bug is resolved. Still
  good defensive hygiene for cards that hardcode unreasonable widths or
  units that fight responsive behavior. Keep as deferred.
- a host-side wrapper utility component in RebelAI to DRY the wrapping pattern
  if more SUU call sites appear later (no longer relevant — the final shape
  uses no wrapper)
