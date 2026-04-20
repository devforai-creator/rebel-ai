# Core Path Hardening Backlog

Updated: 2026-04-20
Status: Active

This document is the current execution backlog for hardening work that should
increase future delivery speed without increasing day-to-day operating surface
area.

It is not:

- a broad repo cleanup queue
- a public-launch backlog
- a justification for adding new infrastructure, dashboards, or hosting modes

Use this backlog when there is no new feature pressure and the goal is to buy
down complexity in the first-class chat path.

See [OPERATING_PLAN.md](../../OPERATING_PLAN.md) for the current operating
contract and [PROJECT_SCALING_HARDENING.md](../../PROJECT_SCALING_HARDENING.md)
for the design direction behind this queue.

## Hard Rules

- Only do hardening that reduces required context, narrows write ownership, or
  shortens verification.
- Prefer deleting ambiguity over adding reusable-looking abstractions.
- Do not add new operator-facing surfaces from this backlog unless they replace
  an existing manual step directly.
- If a cleanup increases config surface, branching, or maintenance burden
  without making the first-class path clearer, stop.
- Every behavior change lands with regression coverage in the same change.

## Why This Queue Exists

The repo is already in a workable state for new features.
The current opportunity is narrower:

- `src/app/api/chat/route.ts` still carries too many responsibilities at once
- runner and post-processing still require more mental stitching than they
  should
- there is still no single obvious pre-deploy verification command for the
  first-class path

That means the valuable hardening now is complexity reduction inside the
maintained path, not more supporting machinery around it.

## Priority Order

### P0-1. Add `verify:core`

Why first:

- `npm run verify` is broader than the day-to-day maintained path
- `npm run ops:smoke` is post-deploy verification, not the default local check
- the repo needs one obvious command for edits that touch the first-class chat
  path

Primary scope:

- [package.json](../../../package.json)
- targeted route, runner, and boundary tests under
  [src/app/api/chat](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat) and
  [src/app/api/internal/chat-job-runner](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner)
- [FIRST_CLASS_SMOKE_CHECKS.md](../../FIRST_CLASS_SMOKE_CHECKS.md) if the docs
  need to distinguish local verification from post-deploy smoke checks more
  explicitly

Done when:

- one command verifies the maintained chat request -> queue -> runner boundary
  plus the existing first-class boundary checks
- the command is fast enough to be the default check during local work on this
  path
- the repo docs state clearly when to use `verify:core`, `verify`, and
  `ops:smoke`

### P0-2. Split `src/app/api/chat/route.ts` by Responsibility

Why second:

- the chat route is still one of the highest-context files in the repo
- request parsing, admission, ownership, persistence, queue dispatch, and
  optional side effects still live too close together
- this is future-capital hardening because almost every chat-path change pays
  this context cost

Primary scope:

- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- adjacent helpers under
  [src/app/api/chat](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat)
- direct tests in
  [src/app/api/chat/route.test.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.test.ts)

Entry checklist:

- decide the minimum stable seams before moving code
- keep the synchronous supported path shorter, not more abstract
- identify legacy compatibility behavior that can be removed instead of carried
  forward

Done when:

- request parsing and normalization live behind one narrow boundary
- admission and ownership checks are easier to read in isolation
- persistence and job-enqueue logic stop competing for attention with optional
  side effects
- regression tests keep the request contract explicit

### P1-1. Push Experimental Side Effects Further from the Core Sync Path

Why next:

- experimental behavior is conceptually separated better than it is physically
  separated
- side effects like translation or provider-specific branches should not define
  the supported chat success contract

Primary scope:

- [src/app/api/chat/route.ts](/home/tmdduq96kr/projects/rebel-ai/src/app/api/chat/route.ts)
- [src/lib/chat/translation-trigger.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/chat/translation-trigger.ts)
- [src/lib/support-tier.ts](/home/tmdduq96kr/projects/rebel-ai/src/lib/support-tier.ts)
- selected runner branches under
  [src/app/api/internal/chat-job-runner](/home/tmdduq96kr/projects/rebel-ai/src/app/api/internal/chat-job-runner)

Done when:

- core request acceptance and enqueue succeed without depending on experimental
  follow-up success
- experimental failures are easier to identify as best-effort behavior
- the maintained path is easier to explain without caveats

### P1-2. Publish a Small First-Class Path Map

Why last:

- once the route and verification surfaces are tighter, the maintained path
  should be written down in one compact map
- the goal is maintainability, not a new architecture spec

Primary scope:

- a small doc under `docs/`
- links to the exact route, queue, runner, and durable-write boundaries that
  define the supported chat success path

Done when:

- one short doc answers what the supported chat path is
- it names which modules own durable writes versus best-effort side effects
- it stays compact enough to remain useful during real implementation work

## Explicitly Parked

Do not pull these into this backlog unless the operating contract changes:

- public-opening abuse controls
- new operator dashboards or admin UI
- a second storage/backend path
- realtime transport redesign
- broad dashboard cleanup unrelated to the first-class chat path

## Default Execution Rule

If a work session does not clearly fit one of the items above, it probably does
not belong in this backlog.
