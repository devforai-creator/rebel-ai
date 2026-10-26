# Character Saves Backlog

- Created: 2026-07-03
- Reactivated: 2026-10-26
- Status: Active (implemented locally; deployment pending)
- Working mode: standard AI-assisted development (Codex implements and verifies)

## Reactivation (2026-10-26)

- The user chose the save feature as the next implementation work.
- Work starts on `codex/character-saves` from the clean `main` commit `b556b03`.
- There was no active backlog at reactivation. The former blocker,
  `recent-conversation-characters`, was completed and archived on 2026-08-15.
- The product decisions below remain unchanged. The user explicitly replaced ATD with
  standard AI-assisted implementation on 2026-10-26.
- The next available migration version at reactivation is `999002`, following
  `999001_explicit_data_api_grants.sql`. The July baseline below is historical.
- First checkpoint: Codex implements the table, foreign-key deletion behavior,
  ownership and link validation, RLS, and explicit Data API grants before writing UI code.
- Follow `docs/DB_CHANGE_WORKFLOW.md`, including local migration application, schema and
  type generation, the grants-test inventory, and relevant DB integration tests.

## Implementation and Verification (2026-10-26)

- Selected defaults: table `character_saves`, management route `/dashboard/saves`, 100-character
  titles, and 20,000-character bodies. The save remains strictly manual and live across chats.
- Implemented the schema, explicit grants, RLS/link guards, CRUD and relinking UI, per-character
  entry points, chat attachment controls, default persona selection, and runner/user-draft reads.
- Local migration application, generated schema/types, and `npm run typecheck` passed.
- `npm run lint`, `npm run format:check`, and `npm run build` passed.
- `npm run test -- --coverage`: 2,737 passed, 84 skipped; coverage thresholds passed
  (87.51% statements, 80.55% branches, 91.32% functions, 87.95% lines).
- `npm run test:db`: 82 passed. `npm run test:db:grants`: 6 passed.
- Browser verification with disposable local fixtures passed: create/edit/reload, starting a chat
  with the default persona, attachment/detachment/reattachment, and returning to the save editor.
  The browser reported no warnings or errors during the verified flow.
- Supabase CLI 2.121.0 was used for migration and type generation. Its stricter generated JSON
  types required preserving the existing variable API input type in the app-facing wrapper and
  narrowing the metadata sanitizer's object return type; runtime behavior is unchanged.
- Remaining: review, linked migration application, Git-based deployment, and post-deployment
  `npm run ops:smoke:active` plus linked database contract checks.
- User behavior and deployment notes: [CHARACTER_SAVES.md](../../CHARACTER_SAVES.md).

## Historical Parking Decision

The product design was settled in conversation on 2026-07-03. This backlog is parked only because
`recent-conversation-characters` is the single active backlog and its migration work is in flight.
The intended pickup was to promote this document to `active/` with its product design unchanged
when that slot became free.

## Problem

The user plays in episodic arcs: one chat session per arc, then a jump to the next situation. The
canon that must survive across sessions (relationship progress, gifts, incidents, vows) currently
lives in the persona description, appended by hand after each arc. That creates real friction:

- `personas.description` caps at 5,000 characters (`src/lib/personas/constants.ts`); one ongoing
  playthrough already consumes roughly half.
- Personas are designed to be reusable across characters (`chats.persona_id`), but the accumulated
  text is bound to one card's world, so reusing the persona elsewhere drags in a foreign history.
- The text is injected as the `[User Information]` block ("who you are") while most of its content
  is actually "what has happened" — the wrong semantic slot.
- Every existing memory layer (`chat_summaries`, `chat_facts`, `lorebook_overrides`) is
  `chat_id`-scoped and dies with its chat. Nothing persists across sessions by design today.

A "save" is the missing cross-session layer: the user-curated canon of one playthrough.

## Confirmed Product Decisions (2026-07-03)

- The entity is called a **save** (UI label: `세이브`). A character card has N saves, like save
  slots; the same card can host independent playthroughs.
- A chat belongs to at most one save. Saveless chats stay valid (fresh starts, one-offs).
- A save is a **title plus a single free-text body**. No structured arc entries in v1.
- Curation is **strictly manual**. No LLM or automated pipeline ever creates or modifies save
  content; the generation runner only reads it for prompt injection. The user's existing flow —
  ask the model in-chat for a session summary, then edit and paste — is the intended loading path.
- A save remembers a **default persona**; a new chat started under a save preselects it. (Current
  play never switches persona mid-playthrough.)
- The body cap is generous; the ceiling is per-turn prompt cost, not storage. When the cap is
  reached, the user consolidates by hand — no automatic compression.
- Prompt injection: a dedicated block between the character prompt and `[User Information]`, framed
  as established past events, present only when the body is non-empty.
- Update semantics are identical to personas: the runner reads the live save body at generation
  time, so an edit applies from the next generation. There is no per-chat snapshot.
- Lifecycle independence is a core requirement: deleting a card must not delete its saves, and a
  save must be re-linkable to another card (covers both deletion and re-import of a card as a new
  row). Deleting a save must not delete its chats.
- Linking scope: `character_id` may reference any character the user can view under the characters
  SELECT policy (own, or public/starter — starter playthroughs must be able to have saves).
  `default_persona_id` may only reference a persona the user owns.
- No dedicated export in v1. With a single text body, copying from the editor is the interim
  backup; file export is deferred.
- No greeting adaptation. Skipping or deleting the character's first message already covers
  continuing-canon starts.
- Personas return to pure identity (abilities, quirks, fears). Moving existing narrative out of a
  persona is a manual user action; no automated migration.

## Proposed Defaults (review before implementation)

- Table `character_saves`: `id`, `user_id` (FK `auth.users`, CASCADE), `character_id` (FK
  `characters`, nullable, `ON DELETE SET NULL`), `default_persona_id` (FK `personas`, nullable,
  `ON DELETE SET NULL`), `title` (≤ 100 chars), `content` (≤ 20,000 chars), timestamps.
- `chats.save_id` (FK `character_saves`, nullable, `ON DELETE SET NULL`).
- Injection label `[Story So Far]`, joined with the existing `\n\n---\n\n` separator in
  `src/app/api/internal/chat-job-runner/system-prompt-builder.ts`.
- Editor shows a character count and a rough token estimate, since the body is paid on every turn
  (BYOK).

## Injection Contract

- Position: after `character.system_prompt`, before the persona `[User Information]` block.
- Framing: the block states that its content is canon that already happened before this session —
  not instructions, not the current scene.
- An empty or whitespace-only body produces no block at all.
- Content is verbatim user text with the same sanitization posture as the persona description.
- Update semantics match the persona: the runner fetches the live body per generation job (the
  persona fetch in `execution-context.ts` is the existing pattern), so a mid-chat edit applies from
  the next generation. In typical play, edits happen between sessions, so the block remains a
  cache-friendly stable prefix in practice.

## Current Repository Baseline (verified 2026-07-03)

- Persona limits live in `src/lib/personas/constants.ts`; the persona block is appended last in
  `system-prompt-builder.ts`.
- The runner fetches the persona fresh on every generation job
  (`src/app/api/internal/chat-job-runner/execution-context.ts`), so persona edits already apply
  mid-chat today; saves adopt the same behavior.
- Public and starter characters exist (`character_visibility` enum; `user_id IS NULL` starters per
  `05_allow_starter_characters.sql`), so users chat with characters they do not own.
- `chats.character_id` is `ON DELETE CASCADE` (`00_initial_schema.sql`): deleting a card erases all
  its chats, messages, summaries, and facts. Saves must not join that cascade — after a card
  deletion the save is the only survivor of the playthrough.
- Persona attachment UX lives inside the chat view (`ChatPersonaWidget`,
  `ChatPersonaSelectDialog` under `src/app/dashboard/chats/[id]/`); save attachment can mirror that
  pattern.
- Migration `91` is taken by the in-flight recency work; the next number as of writing is `92`.
- Database work follows `docs/DB_CHANGE_WORKFLOW.md`, including the `supabase/schema.sql` snapshot
  and regenerated `src/types/database.generated.ts`.

## Smallest Useful First Scope

- `character_saves` table, `chats.save_id`, owner-only RLS, and RLS tests.
- Injection in the chat job runner plus focused `system-prompt-builder` tests (block present,
  absent, empty-body, ordering).
- Save management UI per character: create, rename, edit body, delete; unlinked saves are visible
  and re-linkable to a card.
- Chat wiring: attach/detach a save on a chat, default-persona preselection when starting a chat
  under a save, and a visible indicator of the attached save in the chat view.

## Deferred Until Real Usage

- LLM-assisted arc summarization or one-click "append this session to the save"
- file export/import of saves
- structured arc entries, timelines, or per-arc editing
- automatic compression or consolidation at the cap
- save-scoped retrieval of old chats' facts or summaries
- sharing saves between users
- per-chat snapshot of the save body at attach time (archival fidelity: recording which canon
  version a chat was played under)

## Risks and Required Decisions

- Cap pressure: if bodies routinely approach the cap, decide on manual consolidation aids before
  considering any automatic compression. Canon trust depends on verbatim details (gift lists,
  exact vows) never being rewritten without review.
- Prompt cost: a near-cap body adds meaningful tokens to every turn. The editor must make the size
  visible; raising the cap is a product decision, not a constant change.
- Naming: `character_saves` is proposed, not confirmed; `save` is a generic word in code, so
  confirm the table and route naming before the migration.
- Link validation is two different rules: `character_id` follows character visibility (own or
  public/starter), while `default_persona_id` is owner-only, matching existing persona ownership
  checks. RLS tests must cover cross-user attempts on both columns.
- The injection must stay inside the plain-text generation contract. If implementing it starts
  touching the preset/module/template runtime, stop and review.

## Reopen When

- the `recent-conversation-characters` backlog completes or is parked, freeing the active slot
- or the persona-cap pain becomes blocking sooner, in which case swap this in as a deliberate
  active-backlog change

When reopened, start with the schema on paper: FK actions, caps, and RLS, following
`docs/DB_CHANGE_WORKFLOW.md`, before any UI work.
