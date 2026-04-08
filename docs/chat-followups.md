# Chat Follow-ups

Updated: 2026-04-09

This document tracks non-urgent follow-up ideas for the turn + assistant-variant chat architecture.

These are intentionally deferred until product need is felt in real use.

## Current Policy

- Do not treat these as planned work by default.
- Only pick them up when there is clear user pain, repeated operator friction, or a new product requirement.

## Candidate Follow-ups

### 1. Assistant variant history UI

Possible future UX:

- show that a turn has more than one assistant variant
- let the user open a small variant history panel
- let the user compare the active response with older variants
- optionally let the user switch the active variant manually

This is not needed for the current regeneration model because the system already stores old variants and only shows the active one.

### 2. Branching from older turns

Possible future UX:

- allow regenerate/retry from an older turn
- create a new chat branch instead of mutating the current chat timeline
- preserve shared ancestry metadata for debugging or navigation

This should remain separate from latest-turn in-place regeneration.

### 3. Ephemeral stream replay/resume

Possible future work:

- recover in-progress assistant draft UI after a tab refresh
- replay the latest stream snapshot when a user reconnects mid-generation
- show clearer recovery states for slow or interrupted generation

This is lower priority because the current draft streaming is intentionally ephemeral and the final assistant message is still the source of truth.

### 4. Stronger service-level regeneration tests

Possible future coverage:

- more provider-specific regeneration payload assertions
- more memory-mode assertions across regeneration flows
- explicit broadcast-stream tests for draft assistant updates

Current regression coverage is already in place for the prefix-memory regeneration bug.

### 5. Variant-specific read APIs

Possible future cleanup:

- add explicit endpoints for turn variants/history
- separate "active chat projection" from "variant inspection" reads
- make future compare/history UI simpler to implement

Not necessary while the UI only needs the active assistant variant.

### 6. Re-evaluate message/variant table boundaries

Possible future design question:

- keep assistant variants inside `messages`
- or split them into a dedicated assistant-variant table if variant features become much richer

There is no need to do this now.

### 7. Stream UX polish

Possible future UX improvements:

- smoother cursor animation
- better chunk cadence / debounce tuning
- clearer "regenerating" visual state for replaced assistant bubbles
- better handling of reconnects and long-running jobs

This is optional polish, not architectural debt.
