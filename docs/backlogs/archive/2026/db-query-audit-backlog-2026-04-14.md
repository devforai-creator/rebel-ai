# DB Query Audit Backlog

Updated: 2026-04-15

Status:

- Non-RAG batches in this backlog are closed as of `2026-04-15`
- Remaining RAG follow-up work continues in [rag-retrieval-followup-2026-04-14.md](/home/tmdduq96kr/projects/rebel-ai/docs/backlogs/archive/2026/rag-retrieval-followup-2026-04-14.md)

This document turns the current DB and query-path review into execution batches.

The goal is not to start a broad "optimize the database" effort. The goal is to:

- make the expensive paths measurable
- remove the clearly linear-cost chat paths first
- tighten queue behavior before concurrency turns into operator pain
- keep schema work tied to proven query shapes and concrete regressions

Do not reopen generic repo-wide review from this document. Use this backlog to drive the next DB-focused work sessions.

## Decision

Yes, this work should be documented before implementation starts.

The repo already has strong review coverage for correctness, security, and boundary quality. The current blind spot is different:

- some hot chat paths are functionally correct but scale linearly with conversation length
- several helper paths do counting and projection in application code instead of in SQL
- queue admission is protected, but queue claiming is still not database-atomic
- some list endpoints fetch large JSON payloads only to derive lightweight summaries
- the RAG path likely works at current size, but its cost model is still too implicit

That means the next work should be driven by measured DB behavior, not by another broad correctness pass.

## Working Rules

- Treat this as an execution backlog, not a finding dump.
- One batch should usually target one root cause and one narrow write scope.
- Measure before and after each batch. Do not call work "done" from code shape alone.
- Do not add new denormalized columns or new background jobs unless the measured query shape justifies them.
- Prefer fixing query shape before adding indexes.
- Every behavior change must land with regression coverage in the same change.
- Any change that touches internal routes, queue runners, triggers, or environment-variable contracts must run `npm run ops:smoke` before the batch is closed.

## Current Review Themes

The current DB audit clusters into five themes:

- transcript and projection helpers reread too much chat state
- count/latest helpers compute results in application memory instead of SQL
- queue claim behavior is not yet atomic at the database boundary
- some UI/API list paths fetch heavyweight JSON blobs for lightweight views
- RAG and embedding flows have duplicated metadata lookups and an unproven query-cost model

## P0

### P0-1. Instrument the Hot Paths Before Changing Them

Scope:

- [src/app/api/internal/chat-job-runner/execution-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.ts)
- [src/lib/chat/turn-projection.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-projection.ts)
- [src/lib/chat/job-queue.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/job-queue.ts)
- any small shared timing helpers needed under [src/lib/monitoring](/home/tmdduq96kr/projects/rebel-ai/src/lib/monitoring)

Why:

- we already know the likely hotspots, but we still need a stable before/after baseline
- without timings and row-count signals, later changes will be hard to judge and easy to relitigate

Done when:

- chat runner logs expose timings for transcript load, memory plan build, bilingual lookup, lorebook lookup, queue claim, and any follow-on DB-heavy helper
- the stats are easy to compare across sessions without enabling excessive debug noise globally
- at least one representative long-chat baseline is recorded in the backlog or follow-up notes before optimization work starts

Notes:

- prefer additive instrumentation, not permanent verbose debug logging
- row counts matter as much as latency for this batch

Status on 2026-04-15:

- Complete
- Landed via `876fd46` (`Instrument chat job DB hot paths`)
- Queue claim, transcript load, lorebook/context build, and related hot-path timings are now emitted behind the runner debug switch

### P0-2. Replace App-Side Count and Latest Helpers With SQL-Shaped Reads

Scope:

- [src/lib/chat/turn-projection.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-projection.ts)
- [src/lib/chat-summaries/db-helpers.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/db-helpers.ts)
- callers in [src/lib/chat-memory/prefix-live-blocks.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory/prefix-live-blocks.ts) and [src/app/api/chats/[chatId]/stats/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/stats/route.ts)
- matching tests in [src/lib/chat/turns.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turns.test.ts) and [src/lib/chat-summaries/db-helpers.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/db-helpers.test.ts)

Why:

- current helpers read `chat_turns` rows and reduce them in application code for counts and latest-message lookups
- those helpers are reused by stats, memory, and summary flows, so the same hidden cost shows up in multiple features

Done when:

- count-oriented helpers no longer require loading all conversation turns into application memory
- latest-assistant and latest-message lookups do not scan the whole turn history for common cases
- regression tests still prove message-visibility and projection semantics

Status on 2026-04-15:

- Complete
- Landed via `2293031` (`Switch turn projection helpers to exact counts`)
- The helper paths this batch targeted no longer depend on loading full turn history just to derive counts/latest values

### P0-3. Shrink Chat Transcript Loading to the Real Execution Need

Scope:

- [src/app/api/internal/chat-job-runner/execution-context.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/execution-context.ts)
- [src/lib/chat/turn-projection.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/turn-projection.ts)
- memory builders in [src/lib/chat-memory](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-memory)
- matching runner and turn tests

Why:

- the runner currently rebuilds transcript state up to the active turn even though later stages often only need a bounded live window plus summary state
- this is the clearest linear-cost path in the main chat flow

Done when:

- a normal chat-generation run no longer rereads the entire active transcript for long chats
- regeneration still preserves the correct exclusion and ordering semantics
- long-chat behavior is verified with tests or repeatable fixture coverage, not just with small transcripts

Guardrail:

- do not change chat semantics to get the win
- preserve regeneration correctness and prompt-building output shape

Status on 2026-04-15:

- Complete
- Landed via `8a2a479` (`Reduce transcript reloads in chat runner`)
- The main chat runner transcript path was reduced without reopening regeneration semantics

### P0-4. Move Queue Claiming to a Database-Atomic Boundary

Scope:

- [src/lib/chat/job-queue.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/job-queue.ts)
- Supabase migration(s) under [supabase/migrations](/home/tmdduq96kr/projects/rebel-ai/supabase/migrations)
- [src/app/api/internal/chat-job-runner/service.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/service.ts)
- matching queue and runner tests

Why:

- queue admission already has user/chat protections, but queue claiming still uses a read-then-update pattern
- that is safe enough at low concurrency but produces avoidable contention and wasted work once multiple runners are active

Done when:

- claiming a pending chat job happens through one database-atomic operation
- concurrent runners do not repeatedly race for the same pending row
- the new claim path is covered by direct tests and keeps existing lifecycle-stage semantics

Suggested direction:

- prefer a DB function using `FOR UPDATE SKIP LOCKED` or equivalent row-locking semantics
- add or adjust indexes only after confirming the final query shape

Status on 2026-04-15:

- Complete
- Landed via `38cacc4` (`Make chat job claiming atomic`)
- Pending job claiming now happens at the database boundary instead of through the earlier read-then-update pattern

## P1

### P1-1. Slim Heavy List Endpoints

Scope:

- [src/app/api/modules/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/modules/route.ts)
- any adjacent module-management readers
- matching tests where list payload expectations change

Why:

- the modules list currently fetches large JSON fields such as `lorebook`, `regex`, and `assets` only to derive counts
- this is not the highest-risk path, but it is a clear overfetch pattern and an easy recurring regression source

Done when:

- list endpoints return only fields that the list view actually needs
- large JSON blobs are not loaded merely to compute counts
- any replacement counting logic is explicit and tested

Status on 2026-04-15:

- Complete
- Landed via `06e0dc5` (`Slim module list queries`)
- The modules list no longer fetches heavyweight module JSON just to derive counts; this path now uses the narrower module summary RPC shape

### P1-2. Consolidate RAG and Embedding Metadata Lookups

Scope:

- [src/lib/chat-summaries/context-builder.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/context-builder.ts)
- [src/lib/embeddings.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/embeddings.ts)
- related tests under [src/lib/chat-summaries](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries) and [src/lib](/home/tmdduq96kr/projects/rebel-ai/src/lib)

Why:

- the current path repeats profile and API-key lookup work across the same request
- Vault and embedding calls are expensive enough that duplicated setup work should be justified, not assumed

Done when:

- one chat request does not repeatedly reload the same RAG opt-in and embedding-key metadata
- the path remains correct for users with RAG disabled, missing embedding keys, or inactive provider keys
- tests cover the chosen caching or consolidation boundary

Status on 2026-04-15:

- Initial pass complete for this backlog
- Landed via `3f00731` (`Cache RAG embedding access metadata`)
- Remaining retrieval-specific optimization continues in [rag-retrieval-followup-2026-04-14.md](/home/tmdduq96kr/projects/rebel-ai/docs/backlogs/archive/2026/rag-retrieval-followup-2026-04-14.md)

### P1-3. Validate Vector Search and Fact Lookup With Real Plans

Scope:

- [supabase/schema.sql](/home/tmdduq96kr/projects/rebel-ai/supabase/schema.sql)
- [supabase/migrations](/home/tmdduq96kr/projects/rebel-ai/supabase/migrations)
- [src/lib/chat-summaries/context-builder.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/context-builder.ts)

Why:

- `chat_facts` vector search is probably fine today, but the query plan has not yet been treated as an explicit contract
- this is exactly the kind of issue that stays invisible until data volume changes

Done when:

- `match_chat_facts` has an `EXPLAIN ANALYZE` baseline for representative small and large chats
- we know whether the current `ivfflat` strategy and filters are good enough for expected data volume
- any index or function change is justified by measured plan behavior, not by guesswork

Baseline notes from April 14, 2026:

- Local benchmark, small chat case: 200 `chat_facts` rows in one chat. Inner query used a `Seq Scan` on `chat_facts` plus `top-N heapsort`; `chat_facts_embedding_idx` was not chosen. End-to-end `match_chat_facts(...)` execution was about `9.4ms`, and the inner query itself was about `4.1ms`.
- Local benchmark, large chat case: 5,000 target-chat facts plus 15,000 same-user facts in another chat. Inner query used `idx_chat_facts_chat_id` followed by filter and `top-N heapsort`; `chat_facts_embedding_idx` was still not chosen. End-to-end `match_chat_facts(...)` execution was about `70.5ms`, and the inner query itself was about `82.8ms`.
- Current implication: tuning `ivfflat` list counts is not the next move. The production query shape is chat-scoped first, then exact vector distance sort inside that filtered set, so the present global vector index is not acting as the main access path for this function.
- Current implication: if `chat_facts` growth becomes a real latency problem, the likely next step is a query-shape change or retrieval redesign, not a blind index retune.

Status on 2026-04-15:

- Baseline complete for this backlog
- Landed via `356f46f` (`Document match_chat_facts plan baselines`)
- The follow-on tuning and retrieval redesign work now belongs to [rag-retrieval-followup-2026-04-14.md](/home/tmdduq96kr/projects/rebel-ai/docs/backlogs/archive/2026/rag-retrieval-followup-2026-04-14.md)

## Not In Scope

Do not use this backlog to justify:

- generic "clean up Supabase usage everywhere" edits
- schema churn with no measured hot path behind it
- broad RLS rewrites without a demonstrated policy or planner problem
- visual or product changes unrelated to query cost

## Suggested Execution Order

Start in this order unless new production evidence overrides it:

1. Continue only with [rag-retrieval-followup-2026-04-14.md](/home/tmdduq96kr/projects/rebel-ai/docs/backlogs/archive/2026/rag-retrieval-followup-2026-04-14.md) for retrieval-specific work
2. Do not reopen the non-RAG batches in this document unless a new measured regression appears

## Batch Close Checklist

Before closing a batch:

- confirm before/after measurements exist
- confirm regression tests were added or updated
- run `npm run test -- --coverage` or the smallest targeted test slice that proves the change
- run `npx tsc --noEmit`
- if the batch touched routes, runner wiring, triggers, DB functions, or env contracts, run `npm run ops:smoke`

## Next Session Start Point

The next session should start from [rag-retrieval-followup-2026-04-14.md](/home/tmdduq96kr/projects/rebel-ai/docs/backlogs/archive/2026/rag-retrieval-followup-2026-04-14.md), not by reopening the already-closed non-RAG batches here.
