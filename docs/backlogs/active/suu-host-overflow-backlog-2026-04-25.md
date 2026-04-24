# SUU Host Overflow Escape Hatch Backlog

Updated: 2026-04-25
Status: Active

Parking note:

- drafted on `2026-04-25` after diagnosing a mobile viewport overflow caused by
  an `image_display` SUU card with hardcoded `width: "30em"` in the
  `Aoi Kaoru combined.rbx` package
- briefly parked on `2026-04-25` because this work is opt-in defense for an
  issue that is originally the RBX/SUU card author's responsibility, not a
  regression in RebelAI itself, so SLA is loose
- unparked on `2026-04-25` immediately after parking for tutoring-mode pickup;
  the maintainer wanted to start the implementation right away
- being executed in **tutoring mode**: the maintainer types the implementation,
  AI gives hints/review only, then the diff goes through external code review
  (Codex) before merging

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

Mobile users hitting a `Aoi Kaoru combined.rbx`-style card see the entire
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

Status: `pending`

Primary scope:

- type addition in `packages/react/src` (UGCRenderer props + container style
  merge)
- pass-through plumbing from `UGCRenderer` into `UGCContainer`

Acceptance notes:

- default behavior is unchanged when the prop is absent
- the prop accepts `'hidden' | 'visible' | 'auto' | 'scroll'` only

### P0-2. Add Tests Proving Isolation Stays Locked

Status: `pending`

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

Status: `pending`

Primary scope:

- `safe-ugc-ui-card-spec.md` mention of the new host prop and its boundary
- `SUU/CLAUDE.md:97` line stays accurate: only `overflow` may be host-overridden
  via the new prop, other isolation keys remain protected
- README mention of the new prop on the public package

Acceptance notes:

- doc explicitly states the host wrapper requirement when the prop is used

### P0-4. Build And Bump SUU

Status: `pending`

Primary scope:

- `pnpm build` workspace-wide
- patch or minor version bump on `@safe-ugc-ui/react`
- regenerate types if needed

Acceptance notes:

- `pnpm release:check` passes

### P0-5. Apply Wrapper And Prop In RebelAI

Status: `pending`

Primary scope:

- update `message-renderer.tsx` two call sites to wrap `UGCRenderer` and pass
  `hostOverflow="visible"`
- bump `@safe-ugc-ui/react` dependency in RebelAI `package.json`

Acceptance notes:

- mobile rendering of `Aoi Kaoru combined.rbx` no longer pushes the message
  bubble past the viewport
- text in the same bubble word-wraps normally
- the SUU card itself is reachable via local horizontal scroll inside its
  wrapper
- a smaller-than-viewport SUU card renders unchanged

### P0-6. Add A Smoke Or Visual Check

Status: `pending`

Primary scope:

- minimal regression coverage for the wrapper, either as a snapshot or a
  rendered-DOM unit test

Acceptance notes:

- the wrapper class/style is asserted at both render call sites
- if a future refactor removes the wrapper, the test fails loudly

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
  YAGNI)
- automatic mobile detection inside SUU (rejected by design — UX policy lives
  in the host)
- normalization of card-author width units inside RebelAI's import path (could
  be a separate, future backlog if RBX import ever needs to defensively rewrite
  hardcoded `em`/`px` widths)
- a host-side wrapper utility component in RebelAI to DRY the wrapping pattern
  if more SUU call sites appear later
