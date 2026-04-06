# Getting Started with RebelAI

This is the fastest path from a fresh checkout to a working local or deployed RebelAI instance.

For the full Supabase walkthrough, see [SUPABASE_SETUP.md](../SUPABASE_SETUP.md).

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
npm run dev
```

Open `http://localhost:3000`.

## First-Run Checklist

1. Sign up for an account.
2. Go to `/dashboard/api-keys` and add at least one LLM API key.
3. Go to the character import flow and upload an `.rbx` package.
4. Open the imported character and start a chat.

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

### Other hosts

If you deploy somewhere else, you still need:

- a trusted `INTERNAL_API_ORIGIN`
- a scheduler or worker for the chat/import runners

You can either:

- call the internal trigger routes with `Authorization: Bearer <CRON_SECRET>`
- or run `npm run chat:jobs` and `npm run character:jobs` from your own worker process

## Troubleshooting

### Signup works locally but not on the deployed app

Check your Supabase auth `Site URL` and `Redirect URLs`.

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

### Production works inconsistently or internal calls fail

Check `INTERNAL_API_ORIGIN` first. In non-local environments it must be set to the canonical app URL.

## Next Docs

- [README.md](../README.md)
- [SUPABASE_SETUP.md](../SUPABASE_SETUP.md)
- [SECURITY.md](../SECURITY.md)
- [DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md)
