# Supabase Setup Guide

This guide covers the current RebelAI setup path for a fresh Supabase project.

Use this document when you want to:

- create a new Supabase project for RebelAI
- apply the current schema
- configure auth redirects correctly
- connect local development or a deployed app to that project

If you only want the shortest possible local boot flow, start with [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md).

Repository default note: public signup is currently blocked. For a fresh personal deployment, create the first user from Supabase Dashboard instead of relying on the app signup form.
Storage default note: `character-assets` and `module-assets` are private by default. The app serves them through signed or authenticated URLs at runtime.

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a project.
2. Choose any project name and region that make sense for your users.
3. Save the database password somewhere safe.

## 2. Apply the Schema

RebelAI ships both:

- `supabase/schema.sql` as a generated one-shot hosted bootstrap script
- `supabase/migrations/` as the source of truth for schema changes and local CLI workflows

### Option A: Hosted Supabase project via SQL Editor

This is the simplest path for a fresh cloud project.
It is for first-time bootstrap only, not for incremental production schema
changes after the project is live.

Before running the hosted bootstrap SQL, enable the `vault` and `pgsodium` extensions in Supabase Dashboard if they are not already available for the project.

1. Open Supabase Dashboard.
2. Go to `Database -> Extensions` and enable `vault` and `pgsodium` if needed.
3. Go to `SQL Editor`.
4. Create a new query.
5. Copy the full contents of [`supabase/schema.sql`](./supabase/schema.sql).
6. Run it once.
7. Verify that core tables such as `profiles`, `api_keys`, `characters`, `chats`, `messages`, `chat_generation_jobs`, `character_assets`, and `module_assets` exist.

After this first bootstrap, switch to the migration workflow in
[`docs/DB_CHANGE_WORKFLOW.md`](./docs/DB_CHANGE_WORKFLOW.md). Do not keep making
schema changes directly in SQL Editor unless you are handling an emergency and
will immediately backfill the exact SQL into a migration file.

### Option B: Local Supabase CLI workflow

Use this if you are developing locally with the Supabase CLI.

```bash
supabase start
supabase db push
```

If you also want to regenerate local TypeScript DB types:

```bash
npm run db:types
```

If you change migrations and still support the hosted SQL Editor path, regenerate the bootstrap file with:

```bash
npm run db:schema
```

## 2A. Ongoing Schema Changes

Once a project exists, use this rule:

- write the change in the next file under `supabase/migrations/`
- test locally with `supabase db push --local` or `supabase db reset`
- regenerate `supabase/schema.sql` with `npm run db:schema`
- push to production with `supabase db push --linked`
- verify with `supabase db diff --linked --schema public`
- if the change touched buckets, storage policies, or signed/public delivery behavior, also verify with `supabase db diff --linked --schema storage`

For the full workflow and drift recovery steps, see
[`docs/DB_CHANGE_WORKFLOW.md`](./docs/DB_CHANGE_WORKFLOW.md).

## 3. Collect Supabase Credentials

In Supabase Dashboard, open `Settings -> API` and copy:

- `Project URL`
- `anon public` key
- `service_role` key

You will use these in `.env.local` or your deployment environment.

Storage note: keep `character-assets` and `module-assets` private. The app serves those files
through authenticated signed URLs, not public bucket reads. Reopening anonymous public reads is an
explicit operating-mode change, not a bootstrap convenience step.

## 4. Configure Authentication URLs

Open `Authentication -> URL Configuration` and set:

- `Site URL`: your canonical app URL
- `Redirect URLs`: at minimum your local dev URL and deployed app URL patterns

Example:

```text
Site URL
https://app.example.com

Redirect URLs
http://localhost:3000/**
https://app.example.com/**
```

If this is wrong, login recovery, email verification, and any future signup flows will point users at the wrong domain.

### Email Auth

Open `Authentication -> Providers -> Email` and verify:

- Email auth is enabled
- Confirm email is enabled if you want verification before use

## 5. Create Local Environment Variables

Copy the example file:

```bash
cp .env.example .env.local
```

Generate strong secrets:

```bash
openssl rand -base64 32
```

Run that command once per secret value you need.

### Minimum local `.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
CHAT_ADMIN_SECRET=generated_secret_1
SUMMARY_GENERATION_SECRET=generated_secret_2
CRON_SECRET=generated_secret_3
```

### Production-only additions

Set these in your deployed environment:

```bash
INTERNAL_API_ORIGIN=https://your-app.example.com
```

`INTERNAL_API_ORIGIN` is required outside local development because Edge and Node internal calls must target a trusted canonical origin.

### Optional variables

- `DEVELOPER_EMAILS`: comma-separated allowlist for developer-only chat UI affordances
- `CHAT_JOB_RUNNER_BATCH_LIMIT`: chat jobs processed per trigger
- `CHARACTER_IMPORT_RUNNER_BATCH_LIMIT`: character import jobs processed per trigger
- `NEXT_PUBLIC_IMPORT_MAX_UPLOAD_MB`: self-hosted import upload cap override. Hosted providers may still enforce a lower hard limit.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: only if Vercel Automation Protection is enabled and internal requests need the bypass header
- `BACKFILL_API_PROVIDER`, `BACKFILL_API_KEY`, `BACKFILL_MODEL_NAME`: only for backfill scripts

## 6. Local Verification

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Then verify the happy path:

1. Open `http://localhost:3000`
2. Create the first user from Supabase Dashboard (`Authentication -> Users`) if you are using the repository defaults
3. Sign in
4. Add an API key in `/dashboard/api-keys`
5. Import an `.rbx` package in the character import UI
6. Start a chat and confirm responses stream
7. Visit `/auth/signup` and confirm the closed-signup notice still renders for the default operating contract

## 7. Optional Admin Access

The first user is not automatically an admin.

If you need admin-only features such as announcement management, run this in Supabase SQL Editor:

```sql
update profiles
set is_admin = true
where id = 'YOUR_USER_ID';
```

You can find the user ID in `Authentication -> Users`.

## 8. Deployment Notes

### Vercel

If you deploy on Vercel:

- set all required environment variables in the project settings
- keep `CRON_SECRET` configured so Vercel Cron can call the trigger endpoints
- set `INTERNAL_API_ORIGIN` to the production app URL
- verify `vercel.json` cron jobs are active after deployment
- run `npm run ops:smoke` against the deployed origin after changing auth, internal triggers, storage delivery, or environment-variable wiring

Current trigger endpoints accept only bearer-token auth. You should not rely on query-string secrets.
Minute-level Vercel Cron is the simplest future public-serving path and requires a plan that supports it. On Vercel Hobby, use an external scheduler or run the runner scripts from another process instead.

### Vercel Hobby / Non-Vercel Hosting

If you self-host elsewhere, or you deploy the app on Vercel Hobby:

- set `INTERNAL_API_ORIGIN` explicitly
- provide a scheduler that calls the internal trigger routes with `Authorization: Bearer <CRON_SECRET>`
- or run `npm run chat:jobs` / `npm run character:jobs` from your own worker process
- run `npm run ops:smoke` after deployment changes and manually confirm one signed asset still loads while the equivalent anonymous public bucket URL does not return `200`

For low-cost hosted setups, keep RBX imports within your storage provider's limits. Raising `NEXT_PUBLIC_IMPORT_MAX_UPLOAD_MB` does not bypass hosted storage caps.

If you are following the current repo operating contract, this low-cost profile is the active maintainer-operated first-class path while signup remains closed.

## Troubleshooting

### `relation does not exist`

Your schema was not applied completely. Re-run `supabase/schema.sql` or `supabase db push`.

### `Server misconfigured`

One or more required env vars are missing. Check:

- `SUPABASE_SERVICE_ROLE_KEY`
- `CHAT_ADMIN_SECRET`
- `SUMMARY_GENERATION_SECRET`
- `CRON_SECRET`
- `INTERNAL_API_ORIGIN` in deployed environments

### Auth emails point to localhost

Your Supabase auth URL configuration is wrong. Re-check `Site URL` and `Redirect URLs`.

### Jobs enqueue but do not run

Check:

- `CRON_SECRET` is set
- `CHAT_ADMIN_SECRET` is set
- Vercel Cron is enabled on a compatible plan or your external scheduler is running
- internal trigger routes return `202`/`200` in logs

### Import or chat works locally but fails in production

Most often this is one of:

- missing `INTERNAL_API_ORIGIN`
- wrong deployed app URL in Supabase Auth settings
- missing internal service secrets

## Related Docs

- [README.md](./README.md)
- [docs/GETTING_STARTED.md](./docs/GETTING_STARTED.md)
- [SECURITY.md](./SECURITY.md)
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
