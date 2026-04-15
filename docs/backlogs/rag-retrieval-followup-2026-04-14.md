# RAG Retrieval Follow-Up Backlog

Updated: 2026-04-15

This backlog is the follow-up to [db-query-audit-backlog-2026-04-14.md](./db-query-audit-backlog-2026-04-14.md).

The first DB audit cycle already removed the obvious hot paths around transcript loading, queue claim, list overfetch, and duplicated RAG metadata lookup. What remains is narrower:

- the current `match_chat_facts` retrieval path still scales with the size of the target chat's fact set
- the current global `ivfflat` index is not the main access path for the production query shape
- the next step should be retrieval-shape design, not blind index tuning

This document is for the next session that focuses only on episodic-memory retrieval.

## Confirmed Baseline

Measured on 2026-04-14 with local `EXPLAIN ANALYZE`:

- Small case: 200 `chat_facts` rows in one chat
  - inner query plan: `Seq Scan` on `chat_facts` + `top-N heapsort`
  - `chat_facts_embedding_idx` not used
  - inner query time: about `4.1ms`
  - wrapped `match_chat_facts(...)` time: about `9.4ms`
- Large case: 5,000 facts in the target chat + 15,000 facts in another chat for the same user
  - inner query plan: `idx_chat_facts_chat_id` scan + filter + `top-N heapsort`
  - `chat_facts_embedding_idx` still not used
  - inner query time: about `82.8ms`
  - wrapped `match_chat_facts(...)` time: about `70.5ms`

Current interpretation:

- the expensive step is not "finding vectors globally"
- the expensive step is "taking the target chat's fact set, computing distance inside it, then sorting"
- changing `ivfflat` knobs alone is unlikely to move the real bottleneck

## Local Rerun Recipe

- Run `npm run benchmark:rag:retrieval`
- The harness lives in [scripts/rag-retrieval-benchmark.sql](/home/tmdduq96kr/projects/rebel-ai/scripts/rag-retrieval-benchmark.sql)
- The command runs [run-rag-retrieval-benchmark.js](/home/tmdduq96kr/projects/rebel-ai/scripts/run-rag-retrieval-benchmark.js), which pipes that SQL file into the local Supabase Postgres container
- It seeds a small fixture and a large fixture in separate transactions
- Each fixture prints both the inner retrieval query plan and the wrapped `match_chat_facts(...)` plan
- Both transactions end with `ROLLBACK`, so no benchmark rows are left behind locally

## Goal

Reduce `match_chat_facts` latency growth for large chats without degrading retrieval quality in a way that makes episodic memory less useful.

## Non-Goals

Do not use this backlog to justify:

- generic pgvector tuning with no measured query-shape change
- broad RAG feature redesign outside `chat_facts` retrieval
- schema churn unrelated to retrieval cost
- relevance tuning based only on intuition and no fixture or prompt evidence

## Working Rules

- Measure every candidate with `EXPLAIN ANALYZE`.
- Prefer query-shape changes before new indexes.
- Keep retrieval quality checks in the same batch as performance work.
- If a batch changes runtime retrieval behavior, add regression coverage for both "returns something useful" and "returns nothing noisy when it should not".
- If a batch introduces new DB functions or route/runner contracts, run `npm run ops:smoke` before closing it.

## Candidate Directions

These are options to evaluate, not commitments.

### Option A. Chat-Scoped Two-Stage Retrieval

Idea:

- first narrow candidates using cheap metadata or range constraints
- then run vector ordering only on that smaller candidate set

Why it may work:

- the current plan already behaves like "scan chat subset, then sort"
- making the subset explicitly smaller is more aligned with the observed bottleneck than retuning the global vector index

### Option B. Fact Tiering Or Compaction

Idea:

- keep fine-grained `chat_facts` for recent ranges
- compact older facts into fewer, denser retrieval units

Why it may work:

- retrieval cost currently grows with the number of fact rows in the chat
- compaction attacks row count directly

Risk:

- compaction may reduce retrieval precision if fact groups get too broad

### Option C. Hybrid Retrieval

Idea:

- retrieve by cheap lexical or structural filters first
- then run vector ranking over the filtered set

Why it may work:

- if semantic ordering is only needed after a rough prefilter, total distance calculations can drop sharply

Risk:

- hybrid filters can become brittle if they depend on text shape rather than stable semantics

## P0

### P0-1. Make The Current Retrieval Cost Visible In Code

Scope:

- [src/lib/chat-summaries/context-builder.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/context-builder.ts)
- `match_chat_facts` call sites and debug info payloads

Done when:

- RAG debug output records enough information to compare retrieval cost before and after a change
- logs include candidate row counts or enough query metadata to reason about scaling
- at least one large-chat fixture path is easy to rerun locally

Status:

- Complete on 2026-04-15
- Retrieval debug output now records fallback fact load timing, embedding timing, RPC timing, total retrieval timing, result counts, and skip reasons
- Candidate fact counts are also recorded when `RAG_DEBUG=true`

### P0-2. Add A Repeatable Retrieval Benchmark Harness

Scope:

- benchmark notes or helper scripts under [scripts](/home/tmdduq96kr/projects/rebel-ai/scripts)
- the follow-up backlog itself if a dedicated script is unnecessary

Done when:

- small and large retrieval cases can be rerun without rebuilding the setup from scratch
- the benchmark clearly distinguishes function wrapper time from inner query plan behavior
- the harness leaves no local benchmark data behind, or cleans it up deterministically

Status:

- Complete on 2026-04-15
- Use `npm run benchmark:rag:retrieval` to rerun the small and large fixtures locally
- The harness is self-cleaning via transaction rollback

## P1

### P1-1. Prototype One Query-Shape Change

Scope:

- `match_chat_facts`
- related retrieval code in [src/lib/chat-summaries/context-builder.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat-summaries/context-builder.ts)
- matching tests

Suggested starting point:

- choose the smallest query-shape change that explicitly reduces candidate rows before vector sort

Done when:

- the new plan is measurably better on the large benchmark
- retrieval output still passes fixture-based quality checks
- the change can be explained in one sentence without hand-waving

### P1-2. Decide Whether Compaction Is Necessary

Scope:

- `chat_facts` generation/storage pipeline
- retrieval callers
- backlog notes from measured benchmarks

Done when:

- we know whether query-shape changes alone are enough
- if not, we have a concrete compaction plan with write-path implications called out explicitly

## Verification

Each candidate batch should close with:

- targeted tests for the retrieval behavior that changed
- `npx tsc --noEmit`
- fresh `EXPLAIN ANALYZE` numbers for small and large benchmark cases
- `npm run ops:smoke` if the batch changes DB contracts used by routes or runner paths

## Recommended Next Session Start

Start with this order:

1. one P1-1 prototype query-shape change
2. rerun `npm run benchmark:rag:retrieval`
3. compare the new large-case plan against the baseline before touching indexes

If that first prototype does not materially improve the large benchmark, stop and choose between hybrid retrieval and fact compaction before writing more code.
