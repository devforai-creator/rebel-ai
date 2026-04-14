# Chat Runtime Tuning

Updated: 2026-04-14

This is the supported tuning entry point for first-class chat runtime behavior.

## Start Here

- `src/lib/chat/runtime-limits.ts`

This module owns the operational knobs that most directly affect request handling and runner
behavior:

- chat request byte caps
- queued chat poller timeout and backoff policy
- reprocess stream write cadence
- chat runner input token budget
- authenticated and anonymous chat rate-limit windows and maxima

## Related Config

- `src/lib/chat-summaries/config.ts`

Summary-generation limits remain separate because they tune summarization behavior rather than the
request/runner transport path. Keep chunk sizing, RAG thresholds, and summary output budgets there.

## Change Rules

- Prefer editing `runtime-limits.ts` instead of inlining new numbers in routes, hooks, or runner
  stages.
- If a new limit is summary-only, keep it in `chat-summaries/config.ts`.
- If a new limit affects request admission, polling, or runner execution, add it to
  `runtime-limits.ts`.
