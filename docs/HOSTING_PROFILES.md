# Hosting Profiles

RebelAI supports more than one deployment style. Use this page to choose the lowest-cost profile that still matches your workload.

## 1. Managed Production

Recommended stack:

- Vercel Pro
- Supabase Pro

Use this when you want the simplest production path. Built-in per-minute Vercel Cron can call the internal trigger routes directly, hosted storage quotas are larger, and Supabase Free-project inactivity pauses are not a concern.

## 2. Low-Cost Self-Hosted

Common stack:

- Vercel Hobby or another Node host
- Supabase Free
- Any external scheduler or worker

This is the lowest-cost supported profile for personal, hobby, or small-community deployments. The important constraint is that you should not rely on Vercel's built-in per-minute cron on Hobby. Instead, schedule the internal trigger routes yourself or run `npm run chat:jobs` and `npm run character:jobs` from another process.

Keep RBX packages within the limits of your storage provider. For hosted Supabase Free, the current global file-size limit is smaller than Pro, so small imports are the safer target. Treat this profile as low-traffic by default and validate it against your own workload.

## 3. Full Self-Hosted

Common stack:

- Any Node host
- Your own scheduler/worker
- Your own Supabase stack or equivalent Postgres/storage setup

Choose this when you want to avoid hosted-plan limits entirely. You own the tradeoff: more flexibility, more infrastructure responsibility.

## Notes

- `INTERNAL_API_ORIGIN`, `CHAT_ADMIN_SECRET`, `SUMMARY_GENERATION_SECRET`, and `CRON_SECRET` are required in every deployed profile.
- Realtime and storage quotas vary by provider plan. Check the provider docs before advertising a public instance.
- If you change hosting assumptions, test chat generation, background job pickup, summary generation, and RBX import before calling the setup production-ready.
