# Memory Modes V1

Historical note: this document captures the first implementation/design pass for switchable memory modes.
For the current top-level doctrine, use [LONG_TERM_MEMORY_STRATEGY.md](./LONG_TERM_MEMORY_STRATEGY.md).

This document defines the first implementation of switchable chat memory modes in RebelAI.

The goal is to let one chat choose between the current summary-window behavior and a new prefix-optimized behavior without hard-binding the feature to a single provider.

## Goals

- Keep the current memory behavior available as Mode A.
- Add a second memory behavior, `prefix_live_blocks`, as Mode B.
- Let chats switch between A and B through `chats.model_config`.
- Keep provider-specific cache logic out of the memory strategy itself.
- Improve Anthropic prompt-cache reuse for long chats when Mode B is selected.

## Non-Goals

- Full plugin or marketplace-style memory modularity.
- Token-aware adaptive sealing in V1.
- Replacing all existing summary/fact code.
- Making Mode B the default.

## Terms

- `summary_window`: Current behavior. Recent messages are trimmed to a fixed window and older history is represented by summaries/facts.
- `prefix_live_blocks`: New behavior. Recent raw conversation grows without FIFO trimming until a seal threshold is reached.
- `live block`: The current unsealed raw conversation segment.
- `sealed block`: A completed historical segment that has already been summarized/fact-extracted and no longer grows.
- `tail`: A small number of recent raw messages retained after sealing to preserve short-range continuity.

## Product Behavior

### Mode A: `summary_window`

This is the current default mode.

- Keep the existing summary pipeline.
- Keep the existing recent-message window behavior.
- Keep the existing context-builder behavior.
- Keep the existing provider behavior.

### Mode B: `prefix_live_blocks`

This mode is optimized for providers that benefit from stable prompt prefixes, especially Anthropic.

- Do not trim the live block with FIFO on every turn.
- Let raw recent conversation continue to grow until a fixed message threshold is reached.
- When the threshold is reached, seal the block.
- After sealing, keep only a small tail of recent raw messages in the live block.
- Historical sealed content is represented by summaries/facts in the prompt.
- The next live block starts from the retained tail and grows again.

## V1 Fixed Defaults

V1 uses simple fixed numbers on purpose.

- `sealEveryMessages`: `100`
- `retainTailMessages`: `4`

These values are configuration fields, but V1 should treat them as conservative fixed defaults rather than adding token-based adaptation.

## Configuration

Store memory-mode selection in `chats.model_config`.

```ts
type ChatMemoryMode = 'summary_window' | 'prefix_live_blocks'

type ChatMemoryConfig = {
  mode: ChatMemoryMode
  sealEveryMessages?: number
  retainTailMessages?: number
}

type ChatModelConfig = {
  alternateModels?: AlternateModelsConfig | null
  memory?: ChatMemoryConfig | null
}
```

Rules:

- Missing `memory` config means `summary_window`.
- Existing `alternateModels` config must continue to work unchanged.
- Memory mode is a chat-level setting, not a global account setting.

## Architectural Rule

Separate these concerns:

1. Memory strategy
2. Provider-specific prompt/caching transport

Memory strategy decides what conversation history should exist as prompt blocks.
Provider transport decides how those blocks are turned into actual request payloads.

This means `prefix_live_blocks` must not contain direct `if provider === 'anthropic'` branching inside the strategy logic.

## Runtime Contract

Introduce a new memory-planning layer, separate from the current summary-only builder.

Suggested shape:

```ts
type MemoryPromptBlock = {
  role: 'system' | 'user' | 'assistant'
  content: string
  cachePreference: 'prefer-cache' | 'no-preference' | 'avoid-cache'
  stability: 'static' | 'sealed' | 'live'
}

type MemoryPlan = {
  mode: 'summary_window' | 'prefix_live_blocks'
  promptBlocks: MemoryPromptBlock[]
  fallbackSystemPrompt: string
  fallbackMessages: SanitizedMessage[]
  ragInfo?: RagResultInfo
}
```

Notes:

- `promptBlocks` is the new provider-agnostic intermediate representation.
- `fallbackSystemPrompt` and `fallbackMessages` allow non-upgraded provider paths to continue working.
- `summary_window` and `prefix_live_blocks` both produce the same top-level contract.

## Provider Handling

### Anthropic

Anthropic-specific cache behavior lives only in the payload builder.

- Render `promptBlocks` into ordered Anthropic system/message blocks.
- Use request-level automatic caching in V1 so the live conversation cache point moves forward automatically.
- When a dynamic lorebook block is present in `prefix_live_blocks`, add one explicit breakpoint on the last stable system block before that lorebook suffix.
- In Mode B, live conversation is still part of the prompt prefix and should not be force-separated into an always-uncached block.

Mode B exists for general architecture reasons, but Anthropic is the primary provider expected to benefit immediately.

### Other Providers

- Flatten `promptBlocks` into the existing system/messages structure as needed.
- Keep current behavior unless there is a clear provider-specific optimization already supported.
- Mode selection must still work even if the provider gets no special cache advantage.

## Sealing Behavior for Mode B

V1 sealing rules:

1. Live block accumulates raw messages.
2. If live block size is below `sealEveryMessages`, do nothing.
3. If live block size reaches `sealEveryMessages`, seal the oldest portion of the live block.
4. Retain the last `retainTailMessages` raw messages as the next live block seed.
5. Generate summaries/facts for the sealed range only.

Expected result:

- The prompt prefix remains stable across many turns.
- The live block grows monotonically between sealing events.
- Sealing causes a step change rather than per-turn FIFO churn.

## Implementation Shape

### 1. Extend chat model config

- Expand `src/lib/chat/model-config.ts` to parse and normalize `memory`.
- Keep backward compatibility with existing `alternateModels`.
- Persist the new config through existing chat settings actions.

### 2. Load mode in the runner

- Ensure the chat job path reads `chats.model_config`.
- Make the selected memory mode available to the runtime that builds prompt context.

### 3. Add a memory-plan dispatcher

Suggested new module area:

- `src/lib/chat-memory/`

Suggested entrypoints:

- `buildMemoryPlan()`
- `updateMemoryState()`

Responsibilities:

- Dispatch between `summary_window` and `prefix_live_blocks`
- Return one common `MemoryPlan`
- Avoid provider-specific branching

### 4. Wrap Mode A rather than rewriting it

Mode A should initially wrap the current implementation.

- Reuse the existing summary pipeline.
- Reuse the existing summary/fact retrieval.
- Adapt the output into `MemoryPlan`.

This keeps the current behavior intact while making room for Mode B.

### 5. Implement Mode B separately

Mode B should not reuse the current recent-window trimming logic.

- Do not rely on the current `slice(-CONTEXT_WINDOW)` approach.
- Build prompt blocks from:
  - static system prompt
  - sealed summary/fact blocks
  - current live raw messages

### 6. Update the payload builder

- Teach the stream payload builder to render from `MemoryPlan.promptBlocks`.
- Keep existing fallback behavior for providers/paths not yet migrated.
- Keep Anthropic-specific cache markup at this layer only.

## Testing

Required coverage for V1:

- `model_config` parsing preserves `alternateModels` and accepts `memory`
- chats with no `memory` config still use `summary_window`
- Mode A output matches current behavior closely enough to avoid regressions
- Mode B accumulates live messages without per-turn FIFO trimming
- Mode B seals at the configured threshold and retains the configured tail
- Anthropic payload builder applies request-level automatic caching for Mode B
- Anthropic payload builder places an explicit breakpoint before dynamic lorebook blocks when present

## Migration Notes

- No data migration is required if `memory` is stored inside existing `chats.model_config`.
- Existing chats default to `summary_window`.
- UI should present Mode B as an opt-in advanced mode.

## Open Questions

- Whether sealed summaries and facts should remain a single combined system block or separate logical blocks in Anthropic mode.
- Whether `retainTailMessages` should be `4` or `6` by default.
- Whether Mode B should reuse existing `chat_summaries` / `chat_facts` tables exactly as-is or store an extra marker for sealed live-block boundaries.

## V1 Decision Summary

- Two modes, one chat-level switch.
- No plugin system yet.
- No token-adaptive logic yet.
- One provider-agnostic memory-planning contract.
- Anthropic-specific cache usage only in the payload-rendering layer.
