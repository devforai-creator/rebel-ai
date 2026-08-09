# Recent Conversation Characters Backlog

Created: 2026-06-30
Status: Parked
Parked: 2026-08-10
Reason: Temporarily deferred while higher-priority chat correctness work is addressed.
Restart point: P1-1, specify pagination and preview semantics.
Working mode: ATD (the learner writes the implementation; the tutor explains, hints, and reviews)

## Outcome

Add a `/dashboard/chats` page where the signed-in user can find characters they have recently
chatted with.

The first release is complete when:

- each character appears at most once
- characters are ordered by the most recent message across all of that user's chats with them
- the list is stable across pages even when timestamps tie
- selecting a row opens `/dashboard/characters/[characterId]`
- the page handles signed avatars, empty data, loading, errors, and additional pages
- another user's chats or messages can never influence the result

## Confirmed Product Decisions

- Use a dedicated nullable `chats.last_message_at` value instead of overloading `updated_at`.
- Show characters, not individual chat rooms, in the new list.
- Build a standalone `/dashboard/chats` page first.
- Add a dashboard quick-action card as the entry point. The repository has no shared dashboard
  sidebar or navigation menu to extend.
- A character row opens the character detail page because the intended workflow starts by finding
  a character. A direct `continue latest chat` action is not part of v1.
- Do not add a recent-conversations section to the dashboard home until the standalone page has
  been used and evaluated.

## Recency Contract

`last_message_at` means the maximum `created_at` of the currently stored `user` or `assistant`
messages in a chat.

- It has no `now()` default. A chat with no eligible messages keeps `last_message_at` as `null` and
  does not appear in the recent list.
- A stored character greeting counts as an eligible assistant message.
- System messages do not make a chat recent.
- Sending a message or creating/regenerating an assistant variant can advance it.
- Inserting an older imported message must not move it backwards.
- Deleting or rolling back the newest message must recompute it from the remaining messages; it can
  move backwards or become `null`.
- Editing message content does not change recency.
- Chat imports preserve the source message timestamp when available. When it is missing, the import
  time becomes the message's `created_at`, so the imported chat may appear recent.

This is a derived-data contract, not a generic `last activity` clock. Changing that meaning requires
a deliberate product decision before changing the trigger.

## Current Repository Baseline

- `/dashboard/chats` has nested chat routes and an error boundary, but no list `page.tsx`.
- The existing per-character chat list orders by `chats.updated_at`.
- `chats.updated_at` changes when chat metadata is updated, not when messages are inserted, so it is
  not a valid conversation-recency signal.
- The next migration number is `91` as of this backlog's creation.
- Character icons may come from private storage and must be resolved through
  `src/lib/assets/character-avatar.ts`; returning raw stored paths is not sufficient.
- Database work must follow `docs/DB_CHANGE_WORKFLOW.md`, including the generated
  `supabase/schema.sql` snapshot. `npm run db:types` alone does not complete that workflow.

## Scope Boundaries

In scope:

- exact chat-level message recency data
- a user-scoped, character-deduplicated query
- keyset pagination
- initial server render plus client-side `Load more`
- a dashboard entry card
- focused database, security, route, and UI tests

Out of scope:

- a chat-room-first or mixed character/chat view
- search, filtering, pinning, or manual sorting
- realtime reordering while the page is already open
- a recent-conversations section embedded on the dashboard home
- a visual redesign of the dashboard or character detail page
- changing `updated_at` semantics

## Working Rules

- Work on one unchecked item at a time.
- Before typing code, the learner explains the expected behavior in their own words.
- The tutor starts with questions or the smallest useful hint, then reviews the learner's diff.
- Run the narrowest relevant test after each item; do not postpone all testing until the end.
- Do not check an item off when code merely compiles. Its `Done when` conditions must hold.
- If a task reveals a product or security decision not settled here, stop and record the decision
  before implementation continues.

## Execution Queue

### P0. Lock the Data Invariant

Goal: make message recency accurate before building a list on top of it.

Primary scope:

- `supabase/migrations/91_add_chat_last_message_at.sql`
- `supabase/schema.sql`
- `src/types/database.generated.ts`
- focused database/RLS integration coverage under `src/lib/rls/`

#### P0-1. Design the migration on paper

- [x] Write down the column nullability, trigger events, eligible roles, backfill query, and rollback
      behavior from the Recency Contract.
- [x] Inspect every current message write path: normal user turns, assistant finalization,
      regeneration, chat import, greeting creation, and persistence rollback.
- [x] Decide whether one trigger function handles insert/delete/relevant updates or whether two
      narrowly named functions are easier to understand and test.

Done when:

- [x] the proposed SQL handles bulk imports whose rows are not inserted in timestamp order
- [x] a failed send that inserts and then deletes a message cannot leave a false recent timestamp
- [x] no application write path needs to remember to update `last_message_at` manually

Design notes:

- Column: nullable `last_message_at` with no default.
- Eligible messages: `user` and `assistant`; exclude `system`.
- INSERT: advance with the greater of the current value and the new message's `created_at`.
- DELETE: recalculate from the remaining eligible messages.
- UPDATE: when `chat_id` changes, recalculate both the old and new chats. Recalculate the affected chat when `role` or `created_at` changes. Ignore unrelated updates such as content or `message_status`.
- Rollback: message deletion uses the same recalculation path, restoring the previous maximum or `null`.
- Backfill: calculate `MAX(created_at)` from existing eligible messages per chat.
- Function split: use a lightweight advance function for INSERT and a full recalculation function for DELETE and relevant UPDATE events.

SQL sketch:

- Add `chats.last_message_at timestamptz` as nullable with no default.
- Backfill with `MAX(messages.created_at)` grouped by `chat_id`, considering only `user` and `assistant` messages.
- On eligible message INSERT, advance the chat's `last_message_at` to the greater of the current value and `NEW.created_at`.
- On eligible message DELETE, recalculate the deleted message's `OLD.chat_id` from the remaining eligible messages.
- On UPDATE, ignore content/status-only changes. Recalculate when `chat_id`, `role`, or `created_at` changes. If `chat_id` changes, recalculate both `OLD.chat_id` and `NEW.chat_id`.

#### P0-2. Add the column, backfill, triggers, and index decision

- [x] Add nullable `last_message_at timestamptz` with no default.
- [x] Backfill it from the maximum eligible `messages.created_at` for each chat.
- [x] Add trigger behavior that maintains the same invariant after insert, delete, and relevant
      changes to `chat_id`, `role`, or `created_at`.
- [x] Schema-qualify referenced objects and give trigger functions a safe `search_path`, following
      the repository's hardened function patterns.
- [x] Keep the recalculation helper internal by revoking direct execution from `public`, `anon`,
      `authenticated`, and `service_role`; trigger functions still execute it as the function owner.
- [x] Defer the candidate partial index
      `(user_id, character_id, last_message_at DESC, id DESC) WHERE last_message_at IS NOT NULL`
      until P1-2, where the planned grouped query can be checked with `EXPLAIN` on representative
      data before adding or rejecting it.

Done when:

- [x] a newer eligible message advances the value
- [x] an older message does not move it backwards
- [x] deleting the newest message restores the next maximum or `null`
- [x] relevant `chat_id`, `role`, and `created_at` updates recalculate the affected chat or chats
- [x] system-only and empty chats remain `null`
- [x] existing chats are backfilled consistently with the same rules

#### P0-3. Prove the invariant locally

- [x] Add integration coverage for insert, out-of-order insert, newest-message delete, final-message
      delete, system-message exclusion, relevant `chat_id`/`role`/`created_at` updates, and
      cross-user isolation.
- [x] Apply the migration locally with `supabase db push --local` or a clean `supabase db reset`.
- [x] Regenerate `src/types/database.generated.ts` with `npm run db:types`.
- [x] Regenerate `supabase/schema.sql` with `npm run db:schema`.
- [x] Run the focused database tests and `npm run typecheck`.

Done when:

- [x] generated types expose `last_message_at` in chat Row/Insert/Update shapes
- [x] `npm run db:schema:check` reports no generated-schema drift
- [x] the focused integration tests pass against local Supabase

Verification evidence (2026-07-16):

- `npm run test:rls` — 5 files and 57 tests passed.
- `npm run db:verify` — generated types, generated schema, schema drift check, and typecheck passed.
- The first cross-user test run exposed direct authenticated execution of the internal recalculation
  helper; the migration now revokes all direct execution from API roles, and the rerun passed.

### P1. Define the Recent-Character Query

Goal: return one deterministic, user-owned row per character without loading all chats into the
application and grouping them in memory.

Expected result shape:

- `character_id`, `character_name`, and stored `avatar_url`
- `last_message_at`
- representative `latest_chat_id` and `latest_chat_title`
- latest visible preview message role/content, or `null`

The representative chat is the user's chat with the greatest
`(last_message_at, chat_id)`. Characters are ordered by
`(last_message_at DESC, character_id DESC)`.

#### P1-1. Specify pagination and preview semantics

- [ ] Define an opaque cursor containing both `last_message_at` and `character_id`; a timestamp-only
      cursor is not acceptable because equal timestamps can skip rows.
- [ ] Define the preview as the newest non-system, completed, non-superseded message in the
      representative chat, ordered deterministically by `sequence`.
- [ ] Clamp page size at the server boundary and use `limit + 1` to determine `hasMore`.
- [ ] Exclude archived characters and chats with `last_message_at IS NULL`.

Done when:

- [ ] two characters with the same timestamp paginate without duplication or omission
- [ ] multiple chats with one character still produce exactly one character row
- [ ] a superseded assistant variant cannot become the visible preview

#### P1-2. Implement the database query boundary

- [ ] Prefer a narrowly named `SECURITY INVOKER` SQL function/RPC in the next migration over a
      client-side group-and-sort query.
- [ ] Make ownership explicit with `auth.uid()` and preserve RLS behavior; do not introduce a
      service-role query for ordinary recent-list data.
- [ ] Set a safe function `search_path`, validate/clamp parameters, and grant only the access needed
      by authenticated users.
- [ ] Inspect `EXPLAIN` output and adjust or remove the candidate index based on evidence.
- [ ] Regenerate database types and `supabase/schema.sql` after the migration.

Done when:

- [ ] the function returns one deterministic row per accessible, non-archived character
- [ ] rows from other users are absent even when IDs or cursor values are guessed
- [ ] the query does not fetch every message or perform an N+1 query per character

#### P1-3. Test grouping, security, and cursor edges

- [ ] Cover one character with several chats, several characters, tied timestamps, null recency,
      archived characters, preview selection, and the final partial page.
- [ ] Cover unauthenticated and cross-user calls.
- [ ] Cover malformed cursors and out-of-range page sizes at the application boundary in P2.

### P2. Add a Shared Server Loader and API Contract

Goal: let the server-rendered first page and client-loaded later pages use one canonical data
boundary.

Suggested scope:

- `src/lib/chat/recent-characters.ts`
- `src/app/api/chats/recent-characters/route.ts`
- colocated tests

#### P2-1. Build the canonical loader

- [ ] Define the domain result and opaque cursor types in one place.
- [ ] Parse and validate cursors without trusting raw URL input.
- [ ] Call the typed RPC, map database errors to a narrow server error, and generate `nextCursor`
      only when another row exists.
- [ ] Resolve private character icon assets in a batch with the existing avatar helper before data
      reaches the UI.

Done when:

- [ ] the page and API route do not duplicate grouping, cursor, or avatar-resolution logic
- [ ] avatar resolution is batched rather than performed once per row
- [ ] internal storage paths are not exposed as browser-ready URLs

#### P2-2. Add the paginated route

- [ ] Return `401` when unauthenticated, `400` for an invalid cursor, and a safe `500` response for
      query failures.
- [ ] Return a stable JSON shape: `characters`, `hasMore`, and `nextCursor`.
- [ ] Add route tests for authentication, parsing, success, empty results, and failure logging.

### P3. Build `/dashboard/chats`

Goal: ship the smallest complete character-first experience.

Suggested scope:

- `src/app/dashboard/chats/page.tsx`
- a feature-local list/client component and tests under the same route
- existing shared dashboard primitives such as `EmptyState`, `SurfaceCard`, and `Button`

#### P3-1. Server-render the first page

- [ ] Authenticate with the existing server Supabase pattern and redirect signed-out users.
- [ ] Call the shared loader directly; do not make the server component fetch its own API route.
- [ ] Add a header and a link back to `/dashboard` consistent with neighboring dashboard pages.
- [ ] Pass only serializable display data and pagination state to the client list.

#### P3-2. Render accessible character rows

- [ ] Show avatar fallback, character name, latest chat title when present, message preview, and a
      relative last-message time.
- [ ] Render a semantic `<time dateTime="...">` with an exact timestamp available as a title or
      accessible label.
- [ ] Make the whole row a keyboard-accessible link to `/dashboard/characters/[characterId]`.
- [ ] Keep preview truncation in a tested formatter and do not render untrusted message content as
      HTML.

Done when:

- [ ] a user can identify and open a recent character using mouse or keyboard
- [ ] missing avatar, title, or preview data does not break layout
- [ ] dark mode and narrow mobile width remain readable

#### P3-3. Add incremental pagination and states

- [ ] Add `Load more` using the P2 route, with an in-flight guard and disabled/loading label.
- [ ] Deduplicate appended rows by `character_id` defensively.
- [ ] Add an empty state, load-more error with retry, and end-of-list behavior.
- [ ] Add interaction tests for append, double-click protection, retry, and no-more-results.

### P4. Add the Real Entry Point

- [ ] Add a `Recent Conversations` quick-action card on `/dashboard` linking to
      `/dashboard/chats`.
- [ ] Keep the existing `Start Chat` card and its `/dashboard/characters` destination unchanged.
- [ ] Add or update a focused dashboard rendering/link test.

Done when:

- [ ] the new page is reachable without manually typing its URL
- [ ] no recent-character data is queried or rendered on the dashboard home

### P5. Correct the Existing Per-Character Chat Ordering

Goal: avoid keeping a second, misleading definition of `recent` after the new recency source exists.

Primary scope:

- `src/app/dashboard/characters/[id]/CharacterDetailContent.tsx`
- `src/app/api/characters/[characterId]/chats/route.ts`
- `src/app/dashboard/characters/[id]/character-detail-types.ts`
- relevant route, mapper, client, and hook tests

- [ ] Replace `updated_at` ordering/display with message recency for chats that have messages.
- [ ] Decide and document where empty chats belong; do not silently treat `updated_at` as a message
      timestamp fallback.
- [ ] Replace the current timestamp-only cursor with a stable composite cursor.
- [ ] Keep export, delete, and `Load more` behavior unchanged.

Done when:

- [ ] the character detail page and recent-character page agree on what `recent conversation` means
- [ ] equal timestamps cannot skip chat rooms during pagination
- [ ] empty-chat placement is intentional and covered by tests

### P6. Verify and Deploy Safely

Pre-deploy:

- [ ] `npm run format:check`
- [ ] focused Vitest suites for recency, query, route, and UI behavior
- [ ] `npm run test:db`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] confirm `supabase/schema.sql` and `src/types/database.generated.ts` are included in the change

Manual local scenarios:

- [ ] a newly sent user message moves its character to the first row
- [ ] the assistant response preserves or advances that placement
- [ ] two chats with one character still show one row
- [ ] a second user cannot see the first user's recent characters
- [ ] tied timestamps paginate correctly
- [ ] import, regeneration, failed-send rollback, message deletion, and chat deletion leave recency
      consistent
- [ ] archived characters are absent
- [ ] selecting a row opens the expected character detail page

Post-deploy, and only after all local database gates in `docs/DB_CHANGE_WORKFLOW.md` pass:

- [ ] apply migrations with `supabase db push --linked`
- [ ] verify `supabase db diff --linked --schema public` reports no schema changes
- [ ] run `npm run ops:smoke:active` because runner-written assistant messages now execute the new
      trigger
- [ ] repeat the core recent-list scenario against the active deployment

## Deferred Until Real Usage

- dashboard-home recent-character section (for example, top five plus `View all`)
- direct `Continue latest chat` action on each character row
- character/chat mixed view
- search, filters, pins, or custom sorting
- realtime list reordering

Reopen a deferred item only after the standalone page reveals a concrete usage need.

## Stop Conditions

Pause and review before proceeding if:

- maintaining recency requires application callers to update the column manually
- the grouped query would require a `SECURITY DEFINER` function or service-role data access
- correct pagination cannot be expressed with an opaque composite cursor
- avatar loading creates per-row queries or exposes private storage paths
- P3 starts turning into a dashboard redesign
- a suggested index is being added without an `EXPLAIN`-based reason

## Recommended First Session

Start only with P0-1. Trace the six message write/rollback paths named there and explain, in plain
language, what should happen to `last_message_at` in each path. Do not write the migration until that
table of cases is internally consistent.
