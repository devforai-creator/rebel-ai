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

## Explicit Data API Grants

Supabase no longer automatically grants Data API access to new `public` tables
(all existing projects switch on October 30, 2026). Existing object grants stay
intact, but fresh projects, preview branches, and local resets recreate tables.
RLS policies do not replace table privileges, and `service_role` bypasses RLS
but still needs table privileges when using supabase-js/PostgREST.

For every new table, include these access decisions in its creation migration:

1. Enable RLS and define the required ownership/visibility policies.
2. Explicitly grant each API role only its required operations. Anonymous access
   is optional; internal tables should normally grant only to `service_role`.
3. Grant privileges on any required serial/identity sequences separately.

For example, for an owner-scoped table used by signed-in users and the server:

```sql
alter table public.your_table enable row level security;

create policy "Users can read their own rows" on public.your_table
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on table public.your_table to authenticated;
grant select, insert, update, delete on table public.your_table to service_role;
-- If the API role needs a sequence:
-- grant usage, select on sequence public.your_table_id_seq to service_role;
```

For an internal table, revoke client access explicitly, then grant the required
server operations. For a database-only table with no Data API access at all,
explicitly `revoke all on table public.your_table from public, anon,
authenticated, service_role` instead of granting an API role access.
Do not use blanket grants on all public tables or restore the old automatic
default privileges. Do not rewrite already applied table-creation migrations;
use a new migration to backfill existing tables instead.

`999001_explicit_data_api_grants.sql` backfills the current table inventory.
The regular unit suite checks future table-creation migrations for an explicit
grant (or an explicit database-only revoke) in the same file. Also update the
role/operation inventory in `supabase/tests/data_api_grants.test.sql.in` when adding
tables. This transactional test removes existing automatic grants, reapplies
the backfill, and checks table/sequence permissions and internal-table isolation;
its changes are rolled back. Future table grants must also be replayed in that
test after the backfill, so they are tested without inherited automatic grants.

```bash
npm run test:db:grants
npm run test:db
```

## Normal Workflow

For incremental schema changes, do not edit production directly in Supabase SQL
Editor.

1. Create the next migration file in `supabase/migrations/`.
   Versions `00` through `99` retain their original names and database history.
   After `99`, use the fixed-width sequence `999000_<name>.sql`,
   `999001_<name>.sql`, and so on. Supabase compares version strings, so `100`
   would be inserted between `10` and `11` instead of following `99`.
   Use Supabase CLI **2.121.0 or later** (CI pins 2.121.0): older CLI versions
   sort whole filenames and cannot reconcile the `99` / `999000` boundary.
   Do not renumber or repair the existing applied history to change ordering.
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
npm run test:db:grants
npm run test:db
```

If the change touches Vault helpers or secret access paths, also run:

```bash
npm run test:vault
```

5. Commit the migration file and generated `supabase/schema.sql`.
6. Apply the pending migration to production.

```bash
supabase db push --linked
```

7. Verify production is still aligned with the repository.

```bash
supabase db diff --linked --schema public
npm run db:contract:linked
```

Expected result:

```text
No schema changes found
[check-linked-supabase-contract] OK ... sensitive_acl=locked
```

The linked contract check covers the boundary that `db diff --schema public`
does not: the CLI project ref must match `NEXT_PUBLIC_SUPABASE_URL`, the three
Storage buckets must remain private, all ten `storage.objects` policies must be
present with their ownership guards, and sensitive table/RPC grants must remain
restricted.

## Automated Production Contract Check

`.github/workflows/supabase-contract.yml` runs the same linked contract check
manually and once per day at 03:23 Asia/Seoul. It is intentionally separate from
pull request CI because it connects to the production database.

The workflow targets the Seoul project explicitly and runs in the GitHub
`Production` environment. Configure `SUPABASE_DB_PASSWORD` as an environment
secret there; never commit the password or store it as a repository variable.
The secret is scoped only to the contract verification step, after dependency
installation has completed.

Run the workflow manually after configuring the secret and confirm one
successful result before relying on the daily schedule. If production moves to
another Supabase project or PostgreSQL version, update the explicit project
metadata in the workflow in the same change.

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

6. Run both production alignment checks after the repair.

```bash
supabase db diff --linked --schema public
npm run db:contract:linked
```

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
