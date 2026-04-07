# Lorebook Prefix Cache Plan

This document records the staged plan for bringing lorebook behavior back into the active chat-generation path while preserving the new prefix-oriented memory mode.

The main goal is to avoid losing product-level chat behavior during testing, without jumping straight into a complex cache-aware lorebook architecture.

## Current State

- The active chat-generation path currently uses only plain-text system fields, memory blocks, and conversation history.
- Lorebook is not currently injected into the runtime prompt.
- `prefix_live_blocks` is working, but real product testing feels incomplete without lorebook behavior.

## Problem

Lorebook entries are not all the same from a caching perspective.

- Some entries are effectively stable across the whole chat.
- Some entries are activated dynamically from recent conversation content.

Anthropic prompt caching works best when stable prompt prefixes remain unchanged across requests.
Keyword-driven lorebook activation behaves more like lightweight retrieval or RAG and can change from turn to turn.

If all lorebook content is treated as one prefix block from the start, prompt-cache reuse will be worse than it needs to be.

## Goals

- Restore lorebook behavior to the active chat-generation path.
- Keep the first reintroduction simple enough to ship and test quickly.
- Preserve a clean path toward a more cache-friendly lorebook architecture later.

## Non-Goals

- Perfect cache behavior for all lorebook variants in the first recovery step.
- Full lorebook modularity or a plugin system.
- Immediate support for every possible lorebook activation strategy.

## Terms

- `stable lorebook`: entries that are always active, pinned, or otherwise expected to remain unchanged for the whole chat.
- `dynamic lorebook`: entries activated from chat content and expected to vary over time.
- `dynamic recall block`: a single prompt block containing the currently active dynamic lorebook entries.

## Recommended Rollout

### Phase 1: Restore Lorebook as One Dynamic Block

This is the lowest-complexity recovery step.

- Re-enable lorebook for active chat generation.
- Render the currently active lorebook entries into one `dynamic recall block`.
- Place that block after sealed summaries/facts and before live conversation.
- Keep formatting deterministic:
  - fixed heading
  - fixed sort order
  - fixed separator style

Why this phase exists:

- It restores product realism for prompt testing quickly.
- It avoids immediate refactoring of lorebook activation into stable/dynamic subtypes.
- It keeps the future upgrade path open.

Tradeoff:

- Cache behavior will be worse than the ideal architecture because the whole lorebook contribution is treated as changing suffix context.

### Phase 2: Split Stable and Dynamic Lorebook

After Phase 1 is working and tested, split lorebook into two buckets.

- `stable lorebook` goes near the front of the prompt.
- `dynamic lorebook` remains a suffix-style recall block.

Recommended prompt order:

1. system / character / persona
2. stable lorebook
3. explicit cache breakpoint
4. sealed summaries/facts
5. dynamic lorebook recall block
6. live conversation
7. automatic caching

Why this order:

- Stable lorebook should live inside a long-lived cacheable prefix.
- Sealed summaries/facts are stable only until the next sealing update.
- Dynamic lorebook should remain behind the stable prefix so it does not invalidate that prefix unnecessarily.

### Phase 3: Reduce Dynamic Lorebook Churn

Only do this if Phase 2 still causes too much prompt-cache instability.

Possible follow-ups:

- restrict activation to recent `N` messages
- sticky activation for a short number of turns
- cap the number of dynamic entries
- consider lightweight relevance ranking before rendering

This phase is optional and should be driven by real usage data.

## Why Phase 1 Comes First

Two possible first steps were considered:

1. immediately split out `stable lorebook`
2. restore all active lorebook content as one dynamic block

The second option is intentionally chosen first because it is lighter:

- existing lorebook activation logic can be reused
- product behavior is restored sooner
- the team can test prompt quality before optimizing cache layout

The first option is still the preferred long-term architecture, but not the cheapest first step.

## Implementation Notes

Phase 1 should keep the implementation deliberately narrow.

- Do not redesign the whole lorebook system.
- Do not add provider-specific lorebook logic inside activation code.
- Keep provider-specific cache behavior in the payload builder layer.
- Make the lorebook block generation deterministic so later cache optimization is easier.

For deterministic rendering, prefer:

- a fixed heading such as `=== Active Lorebook Entries ===`
- stable ordering such as `insertorder`, then key, then a stable fallback
- stable spacing and separators

## Open Questions

- Whether Phase 1 should apply to all memory modes or only `prefix_live_blocks` first.
- Whether stable lorebook should be defined only by `alwaysActive`, or whether a chat-level pinning concept should also count.
- Whether dynamic lorebook should eventually behave more like true retrieval than keyword activation.
