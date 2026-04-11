# First-Class Smoke Checks

Updated: 2026-04-12

This runbook is for the current first-class operating mode:

- signup closed
- personal or closed deployment
- low-cost hosting profile as the real day-to-day mode
- `RBX + SUU` as the primary product surface

Use this document to verify that the current operating path still works after deploys, env changes, or infrastructure adjustments.

It is not a public-launch checklist. It is the smallest repeatable operator checklist for the mode the maintainer actually runs.

## What This Covers

The runbook verifies the parts that tend to drift first on the low-cost profile:

- internal health snapshot
- internal triage snapshot
- storage janitor dry-run
- optional active probes for the chat runner and character import runner

Those checks are exposed through one helper script and a short manual checklist.

## Commands

Passive, read-mostly smoke check:

```bash
npm run ops:smoke
```

Active runner probe:

```bash
npm run ops:smoke:active
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
2. `SMOKE_CHECK_APP_ORIGIN`
3. `INTERNAL_API_ORIGIN`
4. `http://127.0.0.1:3000`

## Passive Check Contract

`npm run ops:smoke` calls:

- `GET /api/internal/health`
- `GET /api/internal/triage`
- `GET /api/internal/storage-janitor?dryRun=1&olderThanDays=1&maxDelete=10`

Interpretation:

- `PASS`: route responded with the expected shape and did not report degraded state
- `WARN`: route responded correctly but reported degraded state or existing failed jobs
- `FAIL`: auth, transport, or response-contract failure

The script exits non-zero on either `WARN` or `FAIL`. That is intentional. A degraded system is still a failed smoke check.

The passive janitor probe checks that dry-run dispatch is accepted quickly. It does not wait for a full storage scan to finish.

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

1. Start the app locally.

```bash
npm run dev
```

2. Run the passive smoke check.

```bash
npm run ops:smoke
```

3. If you changed runner wiring or background auth, run the active probe.

```bash
npm run ops:smoke:active
```

4. Manually verify one end-to-end chat if the deployment is meant to be actively used today.
   Send a message from the UI, then confirm the resulting job moves through `/api/chat/jobs/[jobId]` and appears clean in `/api/internal/triage`.

## Deployed Verification Flow

1. Point the script at the deployed origin.

```bash
SMOKE_CHECK_APP_ORIGIN=https://your-app.example.com npm run ops:smoke
```

2. If the passive check is clean, optionally run the active probe.

```bash
SMOKE_CHECK_APP_ORIGIN=https://your-app.example.com npm run ops:smoke:active
```

3. If either returns `WARN` or `FAIL`, inspect:

- `/api/internal/triage` first for recent failed jobs and degraded services
- `/api/internal/health` for durable service status
- `/api/chat/jobs/[jobId]` for a specific failed job

## Expected Use After Changes

Run this after:

- changing deployment environment variables
- changing scheduler or cron wiring
- changing `INTERNAL_API_ORIGIN`
- modifying runner, janitor, or internal auth behavior
- rolling out a new low-cost host setup

## Related Docs

- [HOSTING_PROFILES.md](./HOSTING_PROFILES.md)
- [GETTING_STARTED.md](./GETTING_STARTED.md)
- [OPERATING_PLAN.md](./OPERATING_PLAN.md)
- [FIRST_CLASS_HARDENING_BACKLOG.md](./FIRST_CLASS_HARDENING_BACKLOG.md)
