# Database Change Workflow

This document defines the database workflow for RebelAI after the production
schema baseline was reconciled with `supabase/migrations/`.

Use this document when you:

- add or change tables, indexes, policies, triggers, or RPC functions
- need to push schema changes to production
- need to recover from schema drift

## Source Of Truth

- `supabase/migrations/` is the source of truth for ongoing schema changes.
- `supabase/schema.sql` is a generated bootstrap snapshot for fresh hosted
  Supabase projects.
- `supabase/schema.sql` must be regenerated after migration changes with:

```bash
npm run db:schema
```

## Normal Workflow

For incremental schema changes, do not edit production directly in Supabase SQL
Editor.

1. Create the next migration file in `supabase/migrations/`.
   This repository currently uses numeric ordering, so continue the sequence:
   `64_<name>.sql`, `65_<name>.sql`, and so on.
2. Apply and test the change locally.

```bash
supabase db push --local
```

If the change is broad or you want a clean rebuild:

```bash
supabase db reset
```

3. Regenerate the hosted bootstrap snapshot.

```bash
npm run db:schema
```

4. Run the checks that match the change.

```bash
npm run typecheck
npm run test
```

5. Commit the migration file and generated `supabase/schema.sql`.
6. Apply the pending migration to production.

```bash
supabase db push --linked
```

7. Verify production is still aligned with the repository.

```bash
supabase db diff --linked --schema public
```

Expected result:

```text
No schema changes found
```

## SQL Editor Rule

Using Supabase SQL Editor is allowed only for:

- initial hosted bootstrap on a brand-new project using `supabase/schema.sql`
- one-off operational queries such as setting `profiles.is_admin = true`
- emergency fixes when CLI access is blocked

If you ever make an emergency schema change in SQL Editor:

1. Copy the exact SQL into the next migration file immediately.
2. Regenerate `supabase/schema.sql`.
3. Run `supabase db diff --linked --schema public`.
4. Do not leave production-only schema changes undocumented in the dashboard.

## Drift Recovery

If local migrations and production drift apart:

1. Back up production before changing migration history.

```bash
supabase db dump --linked --role-only --file /tmp/roles.sql
supabase db dump --linked --schema public,storage --file /tmp/schema-public-storage.sql
supabase db dump --linked --data-only --use-copy --schema public,storage --file /tmp/data-public-storage.sql
```

2. Compare production against the repository.

```bash
supabase db diff --linked --schema public
```

3. If production is the real deployed truth, add a reconciliation migration in
   the repository first.
4. Only after that, repair migration history for versions that are already
   present in production.
5. Push only the new reconciliation migration.

Do not run `supabase db push --linked` against a drifted production database
until you understand what the CLI is about to apply.

## Required Secrets

Keep the project database password available in a safe place. Some recovery
paths and `supabase db push --linked` retries may require:

```bash
export SUPABASE_DB_PASSWORD='your-db-password'
```

Unset it after use:

```bash
unset SUPABASE_DB_PASSWORD
```
