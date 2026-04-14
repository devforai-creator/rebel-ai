# Getting Started with RebelAI

This is the fastest path from a fresh checkout to a working local or deployed RebelAI instance.

For the full Supabase walkthrough, see [SUPABASE_SETUP.md](../SUPABASE_SETUP.md).

Repository default note: public signup is currently blocked. For a fresh personal deployment, create the first user in Supabase Dashboard before logging in. Public signup is a later operating-mode decision, not part of the default boot path.

## Quick Start

### 1. Install dependencies

```bash
npm install
cp .env.example .env.local
```

### 2. Create a Supabase project

You need:

- a Supabase project URL
- an anon key
- a service-role key

Then apply the schema from [`supabase/schema.sql`](../supabase/schema.sql) in Supabase SQL Editor.
If your hosted project does not already have them enabled, turn on the `vault` and `pgsodium` extensions first.

If you want the longer hosted setup flow, use [SUPABASE_SETUP.md](../SUPABASE_SETUP.md).

### 3. Fill in `.env.local`

At minimum, set:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CHAT_ADMIN_SECRET=generated_secret_1
SUMMARY_GENERATION_SECRET=generated_secret_2
CRON_SECRET=generated_secret_3
```

Generate secrets with:

```bash
openssl rand -base64 32
```

If you are deploying the app, also set:

```bash
INTERNAL_API_ORIGIN=https://your-app.example.com
```

## Local Run

Start the app:

```bash
npm run dev:local
```

Open `http://localhost:3000`.

`npm run dev:local` forces `INTERNAL_API_ORIGIN=http://127.0.0.1:3000` for the dev process, so `.env.local` can still keep your deployed origin. If you need the raw env behavior, use `npm run dev`.

## First-Run Checklist

1. Create the first user from Supabase Dashboard (`Authentication -> Users`) if you are using the repository defaults.
2. Sign in with that user.
3. Go to `/dashboard/api-keys` and add at least one LLM API key.
4. Go to the character import flow and upload an `.rbx` package.
5. Open the imported character and start a chat.
6. Run `npm run ops:smoke:local` to verify the current first-class low-cost operating path before deployment.

If you need to create a new `.rbx` package from scratch rather than import an existing one, use the bundled Claude-importable skill documented in [`RBX_AUTHORING_WITH_CLAUDE.md`](./RBX_AUTHORING_WITH_CLAUDE.md).

## Optional Setup

### Admin access

If you need admin-only features such as announcement management, set `profiles.is_admin = true` for your user in Supabase SQL Editor:

```sql
update profiles
set is_admin = true
where id = 'YOUR_USER_ID';
```

### Episodic RAG

If you want embeddings-backed episodic retrieval:

1. Add a Voyage embeddings key in `/dashboard/api-keys`
2. Open `/dashboard/account`
3. Enable episodic RAG
4. Optionally run:

```bash
npm run backfill:embeddings
```

## Deployment Notes

### Vercel

RebelAI is set up to work well on Vercel, but production deployment should include:

- `CHAT_ADMIN_SECRET`
- `SUMMARY_GENERATION_SECRET`
- `CRON_SECRET`
- `INTERNAL_API_ORIGIN`

Vercel Cron calls the trigger routes with bearer auth. You do not need query-string secrets.
Per-minute Vercel Cron is the simplest managed public-serving path and requires a plan that supports minute-level schedules. If you are running the current closed/personal low-cost profile on Vercel Hobby, use an external scheduler or worker instead.

### Vercel Hobby / Other hosts

If you deploy somewhere else, you still need:

- a trusted `INTERNAL_API_ORIGIN`
- a scheduler or worker for the chat/import runners
- a daily call to the storage janitor if you want automatic orphan cleanup

The common low-cost setup is: app on Vercel Hobby or another Node host, Supabase Free, and an external scheduler hitting the internal trigger endpoints.

You can either:

- call the internal trigger routes with `Authorization: Bearer <CRON_SECRET>`
- call `GET /api/internal/storage-janitor` with the same bearer auth once per day
- or run `npm run chat:jobs` and `npm run character:jobs` from your own worker process

Verified reference setup on April 7, 2026: `Vercel Hobby + Supabase Free + cron-job.org`. That configuration successfully processed both character imports and chat jobs end-to-end.

If you use hosted Supabase Free, keep imports within the provider's current storage limits and start with small `.rbx` packages.

This low-cost profile is the current maintainer-operated first-class path while signup remains closed. If you later decide to serve outside users, freeze one public profile first instead of treating low-cost and managed public hosting as equal defaults.

After changing env vars, scheduler wiring, or host assumptions, run the passive smoke check against the deployed origin:

```bash
SMOKE_CHECK_APP_ORIGIN=https://your-app.example.com npm run ops:smoke
```

## Troubleshooting

### Signup page returns a blocked message

This is the current repository default. Create the first user from Supabase Dashboard (`Authentication -> Users`) for personal/closed deployments. If you plan to reopen signup later, update the auth flow intentionally and then verify `Site URL` and `Redirect URLs`.

### Messages do not generate

Check:

- at least one API key is configured in `/dashboard/api-keys`
- `CHAT_ADMIN_SECRET` is set
- `SUMMARY_GENERATION_SECRET` is set

### Import jobs stay pending

Check:

- `CRON_SECRET` is set
- your scheduler is actually hitting the trigger endpoints
- `CHAT_ADMIN_SECRET` is set
- if you are on Vercel Hobby, an external scheduler is configured instead of relying on Vercel Cron

### Production works inconsistently or internal calls fail

Check `INTERNAL_API_ORIGIN` first. In non-local environments it must be set to the canonical app URL.

### Health endpoint shows `healthSource: memory-fallback`

Check that `SUPABASE_SERVICE_ROLE_KEY` and the admin DB path are configured for the deployed environment. The health route should prefer durable service snapshots; `memory-fallback` means it could not load the durable path and is falling back to in-process counters.

### Storage keeps growing unexpectedly

Check:

- `GET /api/internal/storage-janitor` is scheduled at least daily
- the route is called with `Authorization: Bearer <CRON_SECRET>` or `Bearer <CHAT_ADMIN_SECRET>`
- the scheduler endpoint returns `202` quickly instead of timing out
- a manual dry-run such as `POST /api/internal/storage-janitor` with body `{"execute":false,"sampleSize":10}` returns `orphanCount: 0` for both buckets after cleanup

## Next Docs

- [README.md](../README.md)
- [SUPABASE_SETUP.md](../SUPABASE_SETUP.md)
- [SECURITY.md](../SECURITY.md)
- [DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md)
- [FIRST_CLASS_SMOKE_CHECKS.md](./FIRST_CLASS_SMOKE_CHECKS.md)
