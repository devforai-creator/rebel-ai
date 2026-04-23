# Docs Map

This directory now separates day-to-day operating docs from review artifacts and execution backlogs.

The current repo is optimized for a maintainer + AI-agent workflow, not for a large long-lived contributor base.
Keep human-facing docs short and directional. Exact runtime behavior should come from code, tests, migrations, generated types, and the current deployment itself.

## Primary Entry Points

- [README.md](../README.md): top-level landing page and navigation hub
- [PROJECT_BRIEF.md](./PROJECT_BRIEF.md): shortest stable orientation doc for humans and LLMs
- [GETTING_STARTED.md](./GETTING_STARTED.md): quickest route from checkout to a working local or closed deployment
- [FIRST_CLASS_SMOKE_CHECKS.md](./FIRST_CLASS_SMOKE_CHECKS.md): post-deploy verification runbook for the current first-class mode

## Active Docs And Runbooks

- [SUPPORT_BOUNDARIES.md](./SUPPORT_BOUNDARIES.md): stable doctrine for `core / fallback / experimental / removal` plus experimental forbidden zones
- [HOSTING_PROFILES.md](./HOSTING_PROFILES.md): supported hosting profiles and current default mode
- [OPERATING_PLAN.md](./OPERATING_PLAN.md): maintainer operating note for current mode, support boundaries, and public-opening gates
- [LONG_TERM_MEMORY_STRATEGY.md](./LONG_TERM_MEMORY_STRATEGY.md): active doctrine for long-chat memory direction, role split, and future planner/reranker target
- [PROJECT_SCALING_HARDENING.md](./PROJECT_SCALING_HARDENING.md): design direction for keeping the repo maintainable as scope, complexity, and contributor surface area grow
- [FIRST_CLASS_SMOKE_CHECKS.md](./FIRST_CLASS_SMOKE_CHECKS.md): repeatable operator verification
- [MAINTAINER_RBX_IMPORT.md](./MAINTAINER_RBX_IMPORT.md): local-only maintainer runbook for oversized RBX imports
- [FIRST_CLASS_PATH_MAP.md](./FIRST_CLASS_PATH_MAP.md): compact map of the
  maintained chat request -> queue -> runner -> durable-write path
- [LLM_INVOCATION_OWNERSHIP.md](./LLM_INVOCATION_OWNERSHIP.md): inventory of real
  LLM invocation cores, wrappers, and duplicated setup ceremony outside the
  narrow first-class chat path
- [CHAT_RUNTIME_TUNING.md](./CHAT_RUNTIME_TUNING.md): supported chat and runner tuning knobs
- [DB_CHANGE_WORKFLOW.md](./DB_CHANGE_WORKFLOW.md): database migration and schema workflow
- [GOOGLE_CACHE_BOUNDARY.md](./GOOGLE_CACHE_BOUNDARY.md): boundary contract for keeping Google explicit cache removable from the supported Google chat/tool path

## Reference (Not Exact Source Of Truth)

These help humans orient themselves, but they should not be treated as the precise contract when code says otherwise.

- [rbx-spec.md](./rbx-spec.md): RBX notes and implementation entrypoint
- [RBX_AUTHORING_WITH_CLAUDE.md](./RBX_AUTHORING_WITH_CLAUDE.md): RBX authoring workflow with the bundled skill
- [../DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md): schema overview and terminology map; exact schema lives in `supabase/migrations/`, `supabase/schema.sql`, and generated types

## Working Notes (Not Contract Sources)

These are useful design notes and transition records, but they should not be treated as the live product contract without being folded back into code or the small set of active runbooks above.

- [chat-followups.md](./chat-followups.md)
- [auth-session-hardening-architecture.md](./auth-session-hardening-architecture.md)
- [realtime-boundary-checklist.md](./realtime-boundary-checklist.md)
- [chat-regeneration-architecture.md](./chat-regeneration-architecture.md)
- [claude-batch-chat-mode-plan.md](./claude-batch-chat-mode-plan.md)
- [experimental-agentic-transcript-recall.md](./experimental-agentic-transcript-recall.md)
- [lorebook-prefix-cache-plan.md](./lorebook-prefix-cache-plan.md)
- [memory-modes-v1.md](./memory-modes-v1.md)
- [suu-import-validation-plan.md](./suu-import-validation-plan.md)

For long-term memory decisions, prefer [LONG_TERM_MEMORY_STRATEGY.md](./LONG_TERM_MEMORY_STRATEGY.md) before using those working notes as policy.

## Archived Sidecars

These exist for optional local maintenance work, not as active product or rollout surfaces.

- [experimental-agentic-transcript-recall-eval.md](./experimental-agentic-transcript-recall-eval.md): dormant local comparison harness for transcript-recall experiments

## Reviews

Reviews are evidence and recommendations, not the source of truth for the current contract.

- [reviews/production-readiness-followups-2026-04-12.md](./reviews/production-readiness-followups-2026-04-12.md)
- [reviews/review-followups.md](./reviews/review-followups.md)

## Backlogs

Backlogs are execution queues, not contract documents. Use the backlog index
for the current queue and the archive split.

- [backlogs/README.md](./backlogs/README.md): backlog structure, current entry
  point, and archive policy
- current active queue:
  [google-tool-aware-explicit-cache-backlog-2026-04-23.md](./backlogs/active/google-tool-aware-explicit-cache-backlog-2026-04-23.md)
- most recently parked queue:
  [explicit-memory-v0-backlog-2026-04-22.md](./backlogs/parked/2026/explicit-memory-v0-backlog-2026-04-22.md)
- most recently archived queue:
  [llm-invocation-ownership-backlog-2026-04-23.md](./backlogs/archive/2026/llm-invocation-ownership-backlog-2026-04-23.md)
