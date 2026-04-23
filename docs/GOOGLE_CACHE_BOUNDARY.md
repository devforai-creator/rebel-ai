# Google Cache Boundary

Updated: 2026-04-23

This document defines the runtime boundary between Google chat invocation and
Google explicit context caching.

It is a provider-specific contract for the current RebelAI runtime. Exact
request fields and payload shapes still live in code and tests.

## Problem Statement

Google explicit cache currently leaks into the maintained chat path in three
ways:

- request-stage logic decides ahead of time when Google cache must be disabled
  for tool-capable turns
- the payload builder has a separate `google-explicit-cache` request strategy
- the runner still carries a Google cache/tool compatibility retry path

That makes explicit cache feel closer to a core invocation mode than to an
optional optimization layer.

## Primary Decision

The supported Google chat path must remain correct when explicit cache is fully
disabled.

Google explicit cache is an optional optimization adapter, not a required
execution mode.

This means RebelAI should be able to disable or even remove the explicit-cache
layer without breaking:

- normal Google chat generation
- Google ATR tool-capable turns
- Google provider error handling as a supported path

## Boundary Contract

### 1. Google Core Invocation Owns The Request

The Google core invocation path owns:

- model selection
- system instruction / system prompt
- conversation messages
- tool definitions
- tool-choice or tool-config behavior
- normal stream execution and error handling

The core invocation must be valid without `cachedContent`.

### 2. Explicit Cache Owns Optimization Only

The explicit-cache layer owns:

- cache eligibility decisions
- cache creation or reuse
- stable-prefix projection for cacheable content
- any provider-specific `cachedContent` envelope

It must accept an already valid Google invocation and either:

- return a cached variant of that invocation, or
- return the original uncached invocation unchanged

### 3. ATR Must Not Own Cache Policy

ATR and transcript-recall policy may decide:

- whether tools are exposed
- what tool budget applies
- whether tool choice stays `auto` or becomes `required`

ATR must not become the owner of:

- Google cache eligibility
- Google cache fallbacks
- provider-specific cache compatibility rules

### 4. Failure Must Degrade To Uncached Behavior

These cases should degrade to uncached Google invocation rather than becoming a
supported user-visible failure mode:

- explicit cache disabled by env or config
- cache not worth creating
- cache creation failure
- cache incompatibility with a tool-capable invocation

The target contract is:

- `GOOGLE_EXPLICIT_CACHE_MODE=off` still preserves normal Google chat behavior
- turning cache off changes cost and debug/cache metadata, not core correctness

### 5. Future Tool-Aware Cache Must Stay Behind The Same Seam

If RebelAI later supports Google explicit cache on tool-capable turns, that
work must remain inside the explicit-cache adapter seam.

It must not re-entangle cache policy with:

- ATR gate logic
- generic runner stage ownership
- the base Google invocation contract

## Non-Goals

This contract does not require this queue to:

- ship tool-aware explicit cache immediately
- optimize cache TTL or cache hit rate
- add hidden retries that silently spend more provider tokens
- widen ATR into a general provider-orchestration owner

## Target End State

At the end of the boundary cleanup:

1. Google chat and Google ATR/tool turns remain valid with explicit cache off.
2. The maintained Google request path has one supported uncached core shape.
3. Explicit cache is a removable optimization seam around that core shape.
4. Any later tool-aware explicit-cache work can ship as a separate bounded
   follow-up.
