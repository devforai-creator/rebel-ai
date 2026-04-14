# Vercel Usage Follow-Up Backlog

Updated: 2026-04-14

This backlog is the follow-up to the current Vercel usage review for the maintainer-operated deployment.

The goal is not to start a generic "make the app cheaper" pass. The goal is to:

- keep the deployment comfortably below the current Vercel Hobby usage ceiling
- prioritize `Fluid Active CPU` over vanity reductions in metrics that are not actually tight
- remove repeated short-lived function work in the active chat path
- verify scheduler and cron pressure before changing application behavior blindly

Use this document to drive the next Vercel-cost session.

## Current Snapshot

Observed from the current Hobby usage dashboard:

- `Function Invocations`: `264K / 1M`
- `Fluid Active CPU`: `3h 14m / 4h`
- `Fluid Provisioned Memory`: `82.4 GB-Hrs / 360 GB-Hrs`
- `Function Duration`: `0 / 100 GB-Hrs`
- `Fast Data Transfer`: `985.18 MB / 100 GB`
- `Fast Origin Transfer`: `1.48 GB / 10 GB`
- `Image Transformations`: `10K / 5K`
- `Image cache reads`: `510 / 300K`
- `Image cache writes`: `12K / 100K`
- `Cron Job Invocations`: `68,379`

Current interpretation:

- the immediate limit pressure is `Fluid Active CPU`, not `Function Invocations`
- network transfer is not the current bottleneck
- provisioned memory is not the current bottleneck
- image optimization was already disabled in app config, so historical image usage does not justify reopening that path right now
- the active chat UI and scheduler wiring are more likely sources of ongoing Vercel pressure than static asset delivery

## Confirmed Repo State

- [next.config.js](/home/tmdduq96kr/projects/rebel-ai/next.config.js) has `images.unoptimized: true`
- [vercel.json](/home/tmdduq96kr/projects/rebel-ai/vercel.json) is empty, so cron/scheduler configuration is currently outside the repo contract
- chat UI still performs repeated request-path work around job polling, latest-message reconciliation, and usage-stat refresh
- the chat request path still dispatches through an extra internal trigger hop before runner execution

## Decision

Do not optimize for invocation count first.

The next Vercel-focused work should optimize for:

- less repeated active CPU in short request handlers
- fewer redundant request hops in the chat path
- less polling work for data that does not need sub-second freshness
- fewer externally scheduled hits that are not justified by actual maintainer use

If invocation count falls as a side effect, that is useful but secondary.

## Working Rules

- Prefer cutting repeated CPU work before cutting product behavior.
- Do not weaken chat correctness or operator visibility just to lower usage counters.
- Do not treat usage dashboard guesses as facts; verify scheduler wiring and hot routes first.
- For each batch, identify whether the target metric is `Active CPU`, `Invocations`, `Provisioned Memory`, or transfer.
- Keep image optimization out of scope unless a new deployment explicitly re-enables it.
- Any batch that changes runner, cron, trigger, or polling behavior must close with `npm run ops:smoke`.

## Current Pressure Themes

- repeated chat polling paths are likely doing more work than the current single-user profile needs
- usage stats are fetched eagerly even when that information is not always needed
- chat runner dispatch currently pays an extra internal function hop
- cron/scheduler activity is high relative to the current personal deployment footprint
- DB work was reduced in the previous backlog, but Vercel CPU pressure likely remains in route orchestration and repeated JSON/request handling

## P0

### P0-1. Inventory The Real Scheduler And Cron Traffic

Scope:

- deployment-side scheduler configuration outside this repo
- internal trigger routes under [src/app/api/internal](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal)
- operator docs under [docs/GETTING_STARTED.md](/home/tmdduq96kr/projects/rebel-ai/docs/GETTING_STARTED.md) and [docs/HOSTING_PROFILES.md](/home/tmdduq96kr/projects/rebel-ai/docs/HOSTING_PROFILES.md)

Why:

- `vercel.json` does not describe cron behavior, but the dashboard shows high cron invocation volume
- without an inventory, route-level optimization risks targeting the wrong source of pressure

Done when:

- every active scheduler or cron target is enumerated with cadence and ownership
- we know which endpoints are hit by Vercel cron versus external schedulers
- we have a short list of schedules that are more frequent than the personal deployment actually needs

### P0-2. Relax Chat Job Polling For The Maintainer Profile

Scope:

- [src/app/dashboard/chats/[id]/hooks/job-poller.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/job-poller.ts)
- [src/lib/chat/runtime-limits.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/runtime-limits.ts)
- [src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts)
- matching chat UI tests

Why:

- current polling starts at `800ms` and repeats until completion
- for a personal deployment, this is probably more aggressive than necessary
- each poll is cheap in isolation but expensive in aggregate for Vercel Active CPU and route churn

Done when:

- the poll cadence is measurably less aggressive for the default single-user profile
- success/error UX remains acceptable
- job completion still appears promptly enough in normal chats

Guardrail:

- do not create a confusing "message finished but UI looks stuck" experience

### P0-3. Stop Eager Usage-Stats Fetches When The UI Does Not Need Them

Scope:

- [src/app/dashboard/chats/[id]/hooks/useChatUsageStats.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useChatUsageStats.ts)
- [src/app/api/chats/[chatId]/stats/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/stats/route.ts)
- token stats panel and callers in the chat UI

Why:

- the current chat page fetches usage stats on mount and again after relevant updates
- not every session needs immediate token-cost visibility
- repeated stats calls add route CPU even after the earlier DB helper cleanup

Done when:

- stats are fetched only when the corresponding UI actually needs them
- the default chat path does not immediately call `/stats` unless it is required for visible UI state
- token/cost visibility still works when the operator opens or refreshes the stats panel

### P0-4. Measure The Internal Trigger Hop Cost

Scope:

- [src/app/api/chat/background-trigger.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/background-trigger.ts)
- [src/app/api/internal/chat-job-runner/trigger/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/trigger/route.ts)
- [src/app/api/internal/chat-job-runner/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner/route.ts)

Why:

- the current chat request dispatches into an internal trigger route, which dispatches into the runner route
- that may be the right durability boundary, but it is also one extra function hop per request path

Done when:

- we have a measured reason to keep or remove the extra hop
- if the hop is retained, its purpose is explicitly documented
- if the hop is removed, the replacement path preserves auth and delivery guarantees

## P1

### P1-1. Consolidate Post-Completion Chat Fetches

Scope:

- [src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/dashboard/chats/[id]/hooks/useQueuedChat.ts)
- [src/app/api/chats/[chatId]/messages/latest/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chats/[chatId]/messages/latest/route.ts)
- any adjacent chat completion readers

Why:

- after a job completes, the client may still fetch latest message and usage separately
- these post-completion calls are individually reasonable but may be overly fragmented for the current footprint

Done when:

- the post-completion path avoids obviously redundant reads
- any replacement response shape is explicit and tested

### P1-2. Tune Scheduler Cadence To Match The Personal Deployment

Scope:

- scheduler inventory from P0-1
- docs that describe the supported low-cost operating profile

Why:

- the maintainer-operated deployment does not need public-scale background cadence
- cron volume should match actual maintenance and recovery needs

Done when:

- low-value scheduler frequency is reduced where safe
- the supported hosting docs state the expected cadence clearly
- smoke checks still pass after the schedule changes

### P1-3. Add Route-Level Usage Notes For Vercel Hot Paths

Scope:

- this backlog
- [docs/CHAT_RUNTIME_TUNING.md](/home/tmdduq96kr/projects/rebel-ai/docs/CHAT_RUNTIME_TUNING.md) if a stable tuning section is warranted

Why:

- Vercel usage pressure is now an explicit operating concern
- we should not have to rediscover the same hot paths from the dashboard every session

Done when:

- the main chat/runner/scheduler hot paths have a short operator note
- future optimization work can start from named route categories instead of fresh guesswork

## Not In Scope

Do not use this backlog to justify:

- generic frontend shaving that does not move Vercel usage
- broad SSR/cache redesign with no measured route problem
- re-enabling Vercel image optimization
- cost work based only on dashboard screenshots without route-level verification

## Suggested Execution Order

Start in this order unless new production evidence overrides it:

1. P0-1 scheduler inventory
2. P0-2 polling relaxation
3. P0-3 usage-stats lazy fetch
4. P0-4 trigger-hop measurement
5. P1-1 post-completion fetch consolidation
6. P1-2 scheduler cadence tuning

## Batch Close Checklist

Before closing a batch:

- identify which Vercel metric the change is supposed to improve
- record before/after route behavior or measured request count
- update or add regression coverage
- run `npx tsc --noEmit`
- run `npm run ops:smoke` if the batch touched trigger, runner, route, or scheduler behavior

## Next Session Start Point

Start with P0-1, not with another generic dashboard review.
