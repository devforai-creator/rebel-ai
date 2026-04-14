# DB Hygiene Follow-Up Backlog

Updated: 2026-04-14

This backlog is the follow-up to the current DB size and retention review.

The goal is not to start a broad "shrink the database at any cost" effort. The goal is to:

- identify which DB growth is expected product data versus avoidable operational residue
- add retention and cleanup rules where the current schema keeps too much low-value history
- avoid destructive cleanup on data paths that still back active product features
- keep schema and index cleanup tied to measured table and index stats, not vague storage anxiety

Use this document for DB hygiene work only. Do not reopen generic query optimization from here.

## Current Snapshot

Observed on 2026-04-14 from the linked remote database:

- total database size: about `1058 MB`
- top tables by total size:
  - `chat_generation_jobs`: `312 MB`
  - `character_assets`: `204 MB`
  - `messages`: `123 MB`
  - `chat_facts`: `19 MB`
  - `module_assets`: `12 MB`
  - `modules`: `10 MB`
- top index findings from `index-stats`:
  - `character_assets_storage_path_key`: `17 MB`, unused
  - `idx_character_assets_storage_path`: `17 MB`, used
  - `chat_facts_embedding_idx`: `10 MB`, unused
  - `idx_character_assets_display_name`: `8736 kB`, unused
  - `idx_character_assets_canonical_name`: `7656 kB`, unused
  - `module_assets_storage_path_key`: `1984 kB`, unused
  - `messages_chat_id_status_sequence_idx`: `1976 kB`, unused

Important interpretation:

- the current Free-plan downgrade blocker is not only Storage; the database itself is already above the Free database-size ceiling
- the biggest unexpected growth source is `chat_generation_jobs`, not `messages`
- some large indexes look unused or duplicated, but one observation window is not enough to drop them blindly

## Decision

Keep the current Supabase Pro plan for now.

The next DB-focused work should not start from a downgrade attempt. It should start from hygiene:

- `chat_generation_jobs` retention is the clearest low-value storage target
- `debug_info` cleanup is plausible, but must preserve the newest assistant-level diagnostics that the app still reads
- `content_en` is explicitly deferred for now because it backs bilingual-context and translation flows, and breakage there would be easy to miss
- index cleanup should happen only after a proof pass, not directly from one `index-stats` snapshot

## Working Rules

- Treat operational history separately from user-visible product history.
- Do not delete or mutate anything needed for active jobs, recent failure triage, or active batch polling.
- Prefer retention windows and nulling low-value blobs over schema churn when that gets the same outcome.
- Record before/after table-size measurements for every cleanup batch.
- Do not drop an index only because one stats snapshot marked it unused.
- `content_en` is out of scope until bilingual-mode usage and retention requirements are clearer.
- Any batch that adds janitors, changes job lifecycle behavior, or changes runner/trigger assumptions must close with `npm run ops:smoke`.

## Current Review Themes

The current DB hygiene review clusters into five themes:

- `chat_generation_jobs` stores large JSON payloads and appears to retain too much historical queue state
- `character_assets` carries both meaningful metadata growth and potentially excessive index growth
- `messages` is growing in a mostly expected way, but `debug_info` retention is still looser than the UI really needs
- some asset and message indexes may be duplicated or stale
- `content_en` exists for a real feature path and should not be trimmed casually

## P0

### P0-1. Add Retention Rules For `chat_generation_jobs`

Scope:

- [src/app/api/chat/job-persistence.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/job-persistence.ts)
- [src/app/api/internal/triage/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/triage/route.ts)
- any janitor or maintenance route chosen for cleanup
- Supabase migration(s) and tests if a DB-side function is introduced

Why:

- `chat_generation_jobs` is currently about `312 MB` for only `5618` rows
- each row stores `payload jsonb`, and that payload includes the full sanitized message array
- users do not directly read historical queue payloads; they care about the resulting `messages`

Done when:

- active `pending` and `processing` jobs are untouched
- recent failed jobs still exist for triage and investigation
- older `success` rows are either deleted or reduced to a compact retained shape
- the chosen retention window is documented in this backlog or the operator docs
- before/after size deltas are recorded

Guardrails:

- keep whatever the batch and triage flows need for current operation
- do not remove recent `error` rows until triage coverage is explicitly preserved

### P0-2. Tighten `debug_info` Retention On `messages`

Scope:

- [src/app/api/internal/chat-job-runner/post-generation-pipeline.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/post-generation-pipeline.ts)
- [src/app/api/chats/[chatId]/messages/[messageId]/debug/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/messages/[messageId]/debug/route.ts)
- [src/lib/chat/alternate-models.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/alternate-models.ts)
- [src/app/api/chats/[chatId]/stats/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/stats/route.ts)
- matching tests

Why:

- `messages` is product-critical, but `debug_info` is not equally valuable on every historical row
- the app primarily needs current or recent assistant debug context, not indefinite retention on every old assistant message
- debug modal copy already assumes that older messages may not retain server debug data

Done when:

- the app keeps enough `debug_info` for the newest assistant-level diagnostics and cache/cost views
- alternate model switching still has the assistant metadata it needs
- older messages can safely carry `debug_info = null` without breaking normal chat UX
- the retention rule is explicit and covered by tests

Guardrails:

- do not remove `debug_info` from the newest visible assistant state for a chat
- do not break the current alternate-model api-key resolution behavior

### P0-3. Audit Large and Possibly Duplicate Indexes Before Dropping Any

Scope:

- [supabase/schema.sql](/home/tmdduq96kr/projects/rebel-ai/supabase/schema.sql)
- [supabase/migrations](/home/tmdduq96kr/projects/rebel-ai/supabase/migrations)
- representative query plans or code references for the affected tables

Why:

- some large indexes appear unused
- some `storage_path` indexes may be redundant with unique constraints
- dropping the wrong index to save a few MB is a bad trade if it later hurts import or asset lookup behavior

Done when:

- each large drop candidate has a keep-or-remove note backed by actual query usage or schema semantics
- obviously duplicated indexes are either removed or justified
- deferred index candidates are listed explicitly so the next review does not restart from scratch

Priority candidates to inspect first:

- `character_assets_storage_path_key` versus `idx_character_assets_storage_path`
- `module_assets_storage_path_key` versus `idx_module_assets_storage_path`
- `messages_chat_id_status_sequence_idx`
- `idx_character_assets_display_name`
- `idx_character_assets_canonical_name`

## P1

### P1-1. Review Asset Metadata Growth

Scope:

- [supabase/schema.sql](/home/tmdduq96kr/projects/rebel-ai/supabase/schema.sql)
- asset-management routes and import paths
- any cleanup utilities for orphaned or stale asset metadata

Why:

- `character_assets` is already `204 MB` total, with `141 MB` table data and `63 MB` indexes
- even if asset files move to another storage provider later, the metadata table can still keep growing

Done when:

- we know whether old imported asset metadata, aliases, or generation metadata can be pruned
- orphaned rows and stale imports have a documented cleanup path if they exist
- future storage-provider changes do not assume the metadata footprint will solve itself

### P1-2. Defer `content_en` Cleanup Until The Bilingual Feature Contract Is Clear

Scope:

- [src/lib/chat/bilingual-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/bilingual-context.ts)
- [src/lib/chat/translation-service.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-service.ts)
- [src/app/api/messages/translate/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/messages/translate/route.ts)

Why:

- `content_en` is not currently a high-confidence cleanup target
- it backs a real product path even if that path is not heavily used right now
- breakage would be subtle and easy to miss during cleanup work

Done when:

- we have an explicit product decision for bilingual-mode retention
- any cleanup plan is based on actual feature posture, not guesswork

Current decision:

- do nothing to `content_en` in the immediate hygiene pass

### P1-3. Revisit `chat_facts_embedding_idx` Only Through The RAG Query-Shape Work

Scope:

- [docs/backlogs/rag-retrieval-followup-2026-04-14.md](/home/tmdduq96kr/projects/rebel-ai/docs/backlogs/rag-retrieval-followup-2026-04-14.md)
- related schema and function work for `match_chat_facts`

Why:

- the embedding index is currently unused in observed plans
- but the problem appears to be query shape, not merely index existence
- dropping it inside a hygiene pass would mix two different concerns

Done when:

- this decision is revisited only alongside the retrieval redesign work

Current decision:

- do not touch `chat_facts_embedding_idx` from this backlog

## Not In Scope

Do not use this backlog to justify:

- deleting user-visible chat history for storage savings
- broad schema rewrites unrelated to measured table growth
- `content_en` cleanup without a separate bilingual-feature decision
- index drops with no proof beyond one stats snapshot
- generic “move everything off Supabase” work

## Suggested Execution Order

Start in this order unless new production evidence overrides it:

1. P0-1 `chat_generation_jobs` retention
2. P0-2 `debug_info` retention tightening
3. P0-3 index audit
4. P1-1 asset metadata review
5. Leave `content_en` and `chat_facts_embedding_idx` deferred until their feature backlogs are active

## Batch Close Checklist

Before closing a batch:

- record before/after `table-stats` for affected tables
- record before/after `index-stats` when dropping or keeping a large candidate index
- update or add regression coverage for any cleanup logic
- run `npx tsc --noEmit`
- run `npm run ops:smoke` if the batch touched janitors, trigger wiring, runner behavior, or internal maintenance routes

## Next Session Start Point

Start with `chat_generation_jobs` retention, not with speculative cleanup on `messages` or `content_en`.
