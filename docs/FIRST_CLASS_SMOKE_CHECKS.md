# First-Class Smoke Checks

Updated: 2026-04-16

This runbook is for the current first-class operating mode:

- signup closed
- personal or closed deployment
- low-cost hosting profile as the real day-to-day mode
- `RBX + SUU` as the primary product surface

Use this document to verify that the current operating path still works after deploys, env changes, or infrastructure adjustments.
Treat `npm run ops:smoke` and `npm run ops:smoke:active` as post-deploy verification gates for a deployed target, not as replacements for pre-deploy CI checks such as lint, tests, and build validation.

It is not a public-launch checklist. It is the smallest repeatable operator checklist for the mode the maintainer actually runs.

## What This Covers

The runbook verifies the parts that tend to drift first on the low-cost profile:

- closed-signup status page
- internal health snapshot
- internal triage snapshot
- storage janitor dry-run
- optional active probes for the chat runner and character import runner

Those checks are exposed through one helper script and a short manual checklist.

## Gate Semantics

- Pre-deploy checks belong in normal CI: lint, typecheck, unit/integration tests, migration validation, and production build.
- For the maintained first-class chat path, use `npm run verify:core` as the default local pre-deploy check.
- Use `npm run verify` when the change is broader than the first-class chat path or when you want the full repo gate before a PR or release.
- Local smoke checks are rehearsal only. They help catch env and route-contract drift before deploy, but they do not prove that the deployed target is healthy.
- Deployed smoke checks are post-deploy verification. Run them against the actual target origin before treating a high-risk rollout as closed.
- If preview/staging exercises the same risk boundary, smoke there first. If the risk only exists on the real deployment shape, run the gate against production.

## Commands

Passive, read-mostly smoke check:

```bash
npm run ops:smoke
```

First-class local verification before deploy:

```bash
npm run verify:core
```

Passive smoke check against the local dev server:

```bash
npm run ops:smoke:local
```

Active runner probe:

```bash
npm run ops:smoke:active
```

Active runner probe against the local dev server:

```bash
npm run ops:smoke:local:active
```

Target a deployed environment explicitly:

```bash
SMOKE_CHECK_APP_ORIGIN=https://your-app.example.com npm run ops:smoke
```

The script loads `.env.local` or `.env` automatically. At minimum it needs:

```bash
CHAT_ADMIN_SECRET=...
```

Origin resolution order:

1. `--origin https://...`
2. `--local` / `npm run ops:smoke:local`
3. `SMOKE_CHECK_APP_ORIGIN`
4. `INTERNAL_API_ORIGIN`
5. `http://127.0.0.1:3000`

## Passive Check Contract

`npm run ops:smoke` calls:

- `GET /auth/signup`
- `GET /api/internal/health`
- `GET /api/internal/triage`
- `GET /api/internal/storage-janitor?dryRun=1&olderThanDays=1&maxDelete=10`

Interpretation:

- `PASS`: route responded with the expected shape and did not report degraded state
- `WARN`: route responded correctly but reported degraded state or existing failed jobs
- `FAIL`: auth, transport, or response-contract failure

The script exits non-zero on either `WARN` or `FAIL`. That is intentional. A degraded system is still a failed smoke check.

The passive janitor probe checks that dry-run dispatch is accepted quickly. It does not wait for a full storage scan to finish.
The signup probe checks that the deployment still presents the explicit closed-signup notice instead of silently reopening registration UX.

## Active Runner Probe

`npm run ops:smoke:active` includes the passive checks and additionally calls:

- `POST /api/internal/chat-job-runner` with `{"limit":1}`
- `POST /api/internal/character-import-runner` with `{"limit":1}`

Use this only when you are comfortable with the probe consuming pending work.

It is useful after:

- moving scheduler wiring
- rotating secrets
- changing `INTERNAL_API_ORIGIN`
- changing runner deployment assumptions

Do not treat it as read-only. If there is pending chat or import work, it may process it.

If you want a full synchronous janitor dry-run instead of a fast dispatch check, call the runner directly yourself:

```bash
curl -X POST \
  -H "Authorization: Bearer ${CHAT_ADMIN_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"execute":false,"olderThanDays":1,"maxDelete":10,"sampleSize":5}' \
  https://your-app.example.com/api/internal/storage-janitor
```

## Local Verification Flow

This flow is a rehearsal for the deployed verification gate. It is useful before shipping, but it does not replace the deployed-origin smoke requirement for high-risk changes.

1. Start the app locally.

```bash
npm run dev:local
```

2. Run the passive smoke check.

```bash
npm run ops:smoke:local
```

3. If you changed runner wiring or background auth, run the active probe.

```bash
npm run ops:smoke:local:active
```

4. Manually verify one end-to-end chat if the deployment is meant to be actively used today.
   Send a message from the UI, then confirm the resulting job moves through `/api/chat/jobs/[jobId]` and appears clean in `/api/internal/triage`.
5. If the change touched storage delivery or bucket policy, verify one signed asset loads in the UI and that the equivalent anonymous `/storage/v1/object/public/...` URL does not return `200`.

`npm run dev:local` forces `INTERNAL_API_ORIGIN=http://127.0.0.1:3000` for that dev process only. Keep the deployed `INTERNAL_API_ORIGIN` in `.env.local` if you want; you no longer need to swap files just to run local smoke checks.

## Deployed Verification Flow

This is the real release-verification path. Use it after deploy and before treating a high-risk change as complete.

1. Point the script at the deployed origin.

```bash
SMOKE_CHECK_APP_ORIGIN=https://your-app.example.com npm run ops:smoke
```

2. If the passive check is clean, optionally run the active probe.

```bash
SMOKE_CHECK_APP_ORIGIN=https://your-app.example.com npm run ops:smoke:active
```

3. If either returns `WARN` or `FAIL`, do not treat the rollout as closed. Inspect:

- `/auth/signup` if the contract may have drifted toward open registration
- `/api/internal/triage` first for recent failed jobs and degraded services
- `/api/internal/health` for durable service status
- `/api/chat/jobs/[jobId]` for a specific failed job

## Expected Use After Changes

Run this after the change is deployed to the target environment whenever the batch touches:

- changing deployment environment variables
- changing signup or public-access assumptions
- changing scheduler or cron wiring
- changing `INTERNAL_API_ORIGIN`
- modifying runner, janitor, or internal auth behavior
- modifying signed asset delivery or bucket privacy
- rolling out a new low-cost host setup

For first-class chat-path edits, the usual order is:

1. `npm run verify:core`
2. deploy
3. `npm run ops:smoke` or `npm run ops:smoke:active` against the deployed target as needed

## Related Docs

- [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [OPERATING_PLAN.md](./OPERATING_PLAN.md)
- [core-path-hardening-backlog-2026-04-20.md](./backlogs/active/core-path-hardening-backlog-2026-04-20.md)
