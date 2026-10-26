# Character Saves

A save (UI: `세이브`) keeps manually curated events, relationships, and promises across chat
sessions. A persona describes the player; a save describes one playthrough's established history.

## Using Saves

1. Open **세이브 관리** from the dashboard or a character's detail page.
2. Enter a title and the history to keep, choose a character, and optionally choose a default persona.
3. Save, then choose **이 세이브로 새 채팅**. The new-chat form preselects the save and its default
   persona; the persona can still be changed or explicitly omitted.
4. Existing chats can attach or detach a save from the chat header. The collapsed header also
   displays the attached save's title.

Titles allow up to 100 characters and bodies up to 20,000 characters. The body is manual text;
the model never creates, compresses, or updates it automatically. Existing persona history is
moved by copying and editing it yourself.

The editor shows a rough token estimate. The body is included in every response request and
user-draft request, so longer saves consume more context. The estimate varies from actual usage
by language and model.

## Continuity and Lifecycle

- A card can have independent saves. A chat has zero or one attached save.
- The runner reads the live body for every generation. Edits apply to the next response of every
  attached chat; chats do not hold a frozen copy of an earlier save version.
- The save is framed as history established before the session, after the character prompt and
  before persona information. Start the new scene in the chat itself.
- Empty or whitespace-only bodies add no prompt block. A failed attached-save read stops generation
  rather than silently omitting the history.
- Editing or deleting a save, or changing a chat's attachment, waits until relevant pending or
  processing responses have finished.
- Deleting a character preserves its saves and clears their character links. Find these under
  **연결되지 않은 세이브**, then choose another visible card to relink.
- Relinking preserves existing chat attachments. New attachments must match the save's current
  character. Historical chats keep reading the same live save.
- Deleting a persona clears the save's default persona.
- Deleting a save clears its chat links and preserves its chats. There is no save recovery or
  file export in v1; copy the body before deleting it if you need a backup.

Saves are private to their owner. Character links can use owned or visible public/starter cards;
default personas and attached saves must belong to the same user. Database triggers enforce link
ownership and compatibility in addition to application validation and RLS.

## Deployment

Migration: `supabase/migrations/999002_character_saves.sql`.

The migration adds `character_saves`, nullable `chats.save_id`, owner-only RLS, explicit Data API
grants, link-validation triggers, and indexes. No new environment variables are required.
The schema and app types are generated from the local database/migration sources.

Follow [DB_CHANGE_WORKFLOW.md](./DB_CHANGE_WORKFLOW.md). The additive migration must be applied to
the linked database before deploying the app, since the app selects the new table and column.
Deploy from the reviewed Git commit, verify the resulting deployment, then run
`npm run ops:smoke:active` and the linked DB contract checks. Local verification does not replace
these post-deployment checks.
