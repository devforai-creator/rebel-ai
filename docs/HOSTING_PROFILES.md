# Hosting Profiles

RebelAI supports more than one deployment style, but they are not equal first-class modes.

Current operating contract:

- Current maintainer-operated first-class profile: Low-Cost Self-Hosted with signup closed
- Future public-serving default: Managed Production
- Full self-hosted remains an advanced path you should validate against your own workload before treating it as production-ready
- Official profiles assume private `character-assets` and `module-assets` buckets with signed or authenticated asset delivery. Anonymous public bucket reads are not an official default.

Use this page to choose the profile that matches your operating contract, not just the cheapest plan combination.

## 1. Managed Production

Recommended stack:

- Vercel Pro
- Supabase Pro

Use this when you want the simplest public-serving path. Built-in per-minute Vercel Cron can call the internal trigger routes directly, hosted storage quotas are larger, and Supabase Free-project inactivity pauses are not a concern.

This is the intended future public-opening default once public abuse controls and the frozen public profile gate are closed. It is not the current maintainer-operated day-to-day default.

## 2. Low-Cost Self-Hosted

Common stack:

- Vercel Hobby or another Node host
- Supabase Free
- Any external scheduler or worker

This is the lowest-cost supported profile for personal, hobby, or small-community deployments. It is also the current maintainer-operated first-class profile while signup stays closed.

The important constraint is that you should not rely on Vercel's built-in per-minute cron on Hobby. Instead, schedule the internal trigger routes yourself or run `npm run chat:jobs` and `npm run character:jobs` from another process.

Validated reference deployment on April 7, 2026:

- Vercel Hobby
- Supabase Free
- `cron-job.org` calling the internal trigger routes with bearer auth

That setup completed character import and queued chat generation end-to-end successfully. `cron-job.org` is not a hard dependency; it is simply one confirmed working scheduler.

Keep RBX packages within the limits of your storage provider. For hosted Supabase Free, the current global file-size limit is smaller than Pro, so small imports are the safer target. Treat this profile as low-traffic by default and validate it against your own workload.

Do not treat this and Managed Production as equal public-serving first-class modes at the same time. Pick one public contract when you are ready to open signup.

## 3. Full Self-Hosted

Common stack:

- Any Node host
- Your own scheduler/worker
- Your own Supabase stack or equivalent Postgres/storage setup

Choose this when you want to avoid hosted-plan limits entirely. You own the tradeoff: more flexibility, more infrastructure responsibility.

For the current repo operating contract, this should be treated as advanced or experimental unless you are actively running it and verifying the full job and health path yourself.

## Notes

- `INTERNAL_API_ORIGIN`, `CHAT_ADMIN_SECRET`, `SUMMARY_GENERATION_SECRET`, and `CRON_SECRET` are required in every deployed profile.
- Signup is closed in the current repository default. For personal or closed deployments, create the first user from Supabase Dashboard instead of expecting the app to accept open registration.
- Realtime and storage quotas vary by provider plan. Check the provider docs before advertising a public instance.
- If you intentionally reopen public signup or public bucket reads later, treat that as an operating-mode change and update the operator docs and smoke checks in the same change.
- If you change hosting assumptions, test chat generation, background job pickup, summary generation, RBX import, and `GET /api/internal/health` before calling the setup production-ready.
- For the current first-class low-cost path, use [`FIRST_CLASS_SMOKE_CHECKS.md`](./FIRST_CLASS_SMOKE_CHECKS.md) and `npm run ops:smoke` as the default post-change verification flow.
- See [`OPERATING_PLAN.md`](./OPERATING_PLAN.md) for the current first-class mode and the remaining public-opening gates.
