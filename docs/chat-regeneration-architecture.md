# Chat Regeneration Architecture

Updated: 2026-04-09

This document records the recommended architecture for chat message regeneration in RebelAI.

The main decision is to stop treating regeneration as "delete the old assistant message and insert a new one" and instead treat it as "create a new assistant variant for the same turn and switch the active variant only after success".

## Goals

- Make regeneration safe and deterministic.
- Preserve the original assistant response unless regeneration succeeds.
- Stop relying on client-submitted transcript state as the source of truth.
- Give the system a clean path toward response variants and later conversation branching.
- Remove identity and ordering bugs caused by delete-and-reinsert message flows.

## Non-Goals

- Full branch-chat UX in the first step.
- A user-facing response-version browser in the first step.
- Rewriting every chat subsystem in one pass.
- Preserving the current "stream assistant partials directly into the `messages` table" behavior.

## Current State

Current regeneration behavior is split across the UI, chat API, and job runner:

- The client removes the target assistant message from local state before the server accepts or completes the regeneration request.
- The chat API accepts a client-built `messages` array and uses it as generation context.
- The job runner generates a new assistant message row.
- The post-generation pipeline deletes the old assistant message row for regeneration.

This creates a model mismatch:

- UI behavior treats regeneration as in-place replacement.
- Persistence treats regeneration as deletion plus insertion.
- Memory, summaries, translation, and debug data still depend on message identity and stable ordering.

## Problem

The current design has four structural problems.

### 1. Regeneration is destructive

The original assistant response is removed too early.

- If request validation fails, the UI can already be missing the original message.
- If the job fails or times out, the original response may be hidden locally until refresh.
- If persistence fails late, the system has already mixed old and new identities.

### 2. The client transcript is treated as authoritative

The server currently trusts a client-built message array as generation context.

That is risky because:

- local state may be stale
- another tab may have edited or deleted messages
- temporary client-only state may differ from persisted history
- the client can omit the target message and still influence regeneration context

The database should be the source of truth for regeneration context.

### 3. Message identity is not preserved

Current regeneration creates a new assistant message row and removes the old one.

That breaks assumptions in surrounding systems:

- debug data is attached to a specific message row
- translation data is attached to a specific message row
- alternate-model selection reads prior assistant debug metadata
- future features like response history and compare-view want stable lineage

### 4. Sequence-based memory and summaries do not fit regeneration well

`messages.sequence` is an identity column, so deleting one assistant row and inserting another changes the shape of history.

That matters because current summary and memory code uses:

- total message count for chunk planning
- sequence order and offsets for chunk retrieval
- sequence ranges for facts and summaries

Regeneration should not change what historical turn a response belongs to.

## Product Decision

Adopt a `turn + assistant variants` model.

### High-level rule

- A `turn` contains one user message and zero or more assistant response variants.
- Exactly one assistant variant per turn is active at a time.
- The chat UI renders the active assistant variant for each turn.
- Regeneration creates a new assistant variant for the same turn.
- The active assistant variant changes only after the new variant is complete and persisted successfully.

### Regeneration policy

- Allow in-place regeneration only for the latest completed turn.
- Treat regeneration of older turns as a future branch-chat feature, not as in-place replacement.

This follows the common product pattern used by mainstream chat tools:

- latest response can be retried or regenerated
- alternative responses are conceptually variants of the same turn
- branching older history is a separate capability

## Terms

- `turn`: one user message plus its assistant responses
- `assistant variant`: one generated assistant response for a turn
- `active assistant variant`: the assistant response currently shown for a turn
- `latest turn`: the highest turn index in the chat
- `branch`: a new conversation that forks from an older turn; not part of the first implementation

## Recommended Data Model

Introduce `chat_turns` and make assistant responses turn-scoped.

### New table

```sql
create table chat_turns (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  user_id uuid not null,
  turn_index bigint not null,
  user_message_id uuid not null references messages(id) on delete restrict,
  active_assistant_message_id uuid null references messages(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, turn_index),
  unique (user_message_id)
);
```

### Message table extensions

```sql
alter table messages
  add column turn_id uuid null references chat_turns(id) on delete cascade,
  add column variant_index integer null,
  add column supersedes_message_id uuid null references messages(id) on delete set null,
  add column message_status text not null default 'completed';
```

### Intended usage

- User messages:
  - `turn_id` required
  - `variant_index` null
- Assistant messages:
  - `turn_id` required
  - `variant_index >= 1`
  - `supersedes_message_id` optionally points to the previous active variant

### Important note

This design intentionally keeps historical assistant variants instead of deleting them.

That gives us:

- safe regeneration rollback
- future compare/history UI
- clean lineage for debugging

## Core Invariants

These invariants should remain true after the refactor.

- The database is the source of truth for chat context.
- Regeneration never deletes the currently active assistant response before success.
- A turn has at most one active assistant message.
- The active assistant message for a turn changes atomically after successful generation.
- Latest-turn regeneration is allowed.
- Older-turn in-place regeneration is not allowed.
- Failing regeneration leaves the active assistant response unchanged.

## Runtime Flow

### Normal send

1. Persist the new user message.
2. Create a new `chat_turns` row.
3. Enqueue a generation job with `chatId` and `turnId`.
4. The worker rebuilds context from the database.
5. The worker generates the assistant response.
6. The worker inserts a completed assistant message variant.
7. The worker updates `chat_turns.active_assistant_message_id`.

### Regenerate latest turn

1. The client sends `chatId` and `targetAssistantMessageId`.
2. The server validates that:
   - the target belongs to the chat
   - the target is the active assistant for its turn
   - the turn is the latest completed turn
3. The server enqueues a generation job with `chatId`, `turnId`, and `supersedesMessageId`.
4. The worker rebuilds context from the database, excluding the superseded assistant variant from the live prompt.
5. The worker inserts a new assistant message variant.
6. The worker atomically switches `active_assistant_message_id` to the new variant.
7. The old variant remains stored but inactive.

## API Direction

### Chat send API

The send API should move away from accepting a full client transcript for regeneration.

Preferred request shapes:

```ts
type SendChatRequest = {
  chatId: string
  apiKeyId: string
  userMessage: string
}

type RegenerateChatRequest = {
  chatId: string
  apiKeyId: string
  targetAssistantMessageId: string
}
```

### Server responsibility

The server should:

- validate chat ownership
- resolve the target turn
- rebuild context from persisted chat history
- enforce latest-turn-only regeneration

## UI Direction

The chat UI should render turn projections, not raw assistant message churn.

Recommended behavior:

- Do not remove the current assistant message from local state when regeneration starts.
- Show a loading state on the latest turn while regeneration is running.
- Replace the visible assistant response only after the active variant changes in persisted state.
- If regeneration fails, keep the existing assistant response visible.

The first implementation does not need a version switcher.

The UI can keep showing only the active assistant variant while the data model still stores prior variants.

## Streaming Decision

Recommended first-step simplification:

- stop streaming partial assistant content into the persistent `messages` table
- keep job polling and typing indicators for UX feedback
- persist the assistant variant only once the full response is ready

Why this is recommended:

- it removes partial-row cleanup complexity
- it avoids transient duplicate assistant rows during regeneration
- it makes active-variant switching simpler and safer

If true persistent streaming is needed later, it should be introduced as a separate design with a draft/staging state, not by overloading final assistant rows.

## Memory and Summary Implications

This refactor should eventually move memory and summary logic toward turn-based ranges instead of raw message-sequence assumptions.

### Near-term rule

During the first regeneration refactor:

- keep existing summary behavior working
- avoid delete-and-reinsert message flows that worsen sequence instability

### Follow-up direction

Move summaries and facts toward turn-oriented boundaries, for example:

- chunk summaries over `N` turns
- facts linked to turn ranges instead of message sequence ranges

This change is not required in the first PR, but the regeneration architecture should not block it.

## Translation and Debug Implications

Two follow-ups should be planned after the core turn model lands.

### Translation

Bilingual-memory lookup should move away from `role + content` matching and toward stable message identity.

### Debug and analytics

Debug data and usage records should remain associated with the concrete assistant variant that produced them.

That is a better fit than reusing one mutable assistant row across retries.

## Backfill Strategy

Existing chats need a one-time turn backfill.

Recommended backfill rule:

1. Order all messages in a chat by current `sequence`.
2. Pair each user message with the next assistant message as one turn.
3. Create one `chat_turns` row per detected pair.
4. Assign `turn_id` on the user message and assistant message.
5. Set the assistant message as the active variant for that turn.

Edge cases:

- trailing user message with no assistant response yet
- orphan assistant message with no preceding user message
- edited or deleted historical gaps

These should be handled explicitly in the migration script and recorded in migration notes.

## Rollout Plan

### Phase 1: Document and lock the architecture

- Add this design note.
- Confirm latest-turn-only regeneration policy.
- Confirm turn-plus-variant data model.

### Phase 2: Introduce `chat_turns`

- Add schema changes.
- Backfill existing chats into turns.
- Add read helpers for turn projections.

### Phase 3: Switch send flow to turns

- Create turns during normal user sends.
- Move worker payloads to `chatId + turnId`.
- Rebuild prompt context from the database.

### Phase 4: Switch regeneration flow

- Validate latest active assistant only.
- Generate a new assistant variant.
- Atomically switch active assistant on success.
- Keep old assistant variants inactive instead of deleting them.

### Phase 5: Simplify persistent streaming

- Remove partial assistant-row streaming from the persistent table.
- Keep typing indicator and job polling UX.

### Phase 6: Follow-up cleanup

- Move bilingual-memory matching to stable identity.
- Move summaries and facts toward turn-based ranges.
- Add branch-chat support if older-turn retries become important.

## Testing

Required coverage for the refactor:

- sending a new user message creates one new turn
- successful regeneration creates a new assistant variant for the latest turn
- failing regeneration does not change the active assistant variant
- older-turn regeneration is rejected
- worker context rebuild uses persisted DB state, not client transcript state
- turn projection returns one assistant response per turn
- backfill creates correct turns for existing message history

## Open Questions

- Whether assistant variants should live in the existing `messages` table or be split into a dedicated `assistant_message_variants` table later.
- Whether a trailing user-only turn should be created immediately on send or only after job enqueue succeeds.
- Whether branch chat should clone all turns up to the fork point or keep shared ancestry metadata.

## Decision Summary

- Regeneration becomes "new assistant variant for the same turn".
- The original active response is preserved until replacement succeeds.
- Latest turn only for in-place regeneration.
- The server rebuilds context from the database.
- `chat_turns` becomes the stable unit of chat history.
- Partial persistent assistant streaming is removed in the first cleanup pass.
