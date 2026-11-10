# Supabase adapter

This directory contains local Supabase configuration, declarative schemas, generated migrations, functions and tests.

Database definitions belong in `schemas/`. With the current pg-delta workflow, generate versioned migrations with `supabase db schema declarative sync -f <description> --no-apply`, review the output, then apply and verify it against a local database before any remote change. Check the installed CLI version and command help first.

Supabase remains an interchangeable adapter behind provider-neutral contracts. `auth.users` is the identity source; public profile or application tables must use RLS and ownership-aware policies.

## Online file ownership

Reset the local stack with `supabase db reset --local` and apply the configured private bucket with `supabase seed buckets --local`. Run `supabase test db --local`, `npm run test:integration` and `supabase db advisors --local --type all`. For the signed-in host, set `SUPABASE_SECRET_KEY` in its ignored server environment. Its browser client uses only the publishable key. The server validates the uploaded drawing as the signed-in owner before using its privileged client to insert the listing. An immutable snapshot and its listing share the same deletion lifecycle.

Run `npm run preview:build`, start the production host on port 3100 and execute `npx playwright test tests/e2e/preview.spec.ts --grep 'signed-in ownership finalisation' --workers=1` to exercise the cookie-authenticated endpoint and confirm it refuses a foreign origin.

For the two-account publication and invitation check, run `npx playwright test tests/e2e/preview.spec.ts --grep 'published view and edit invites' --workers=1`. The local fixture provisions its own guest. For hosted verification supply a separate confirmed guest through `FIGCRAFT_E2E_GUEST_EMAIL` and `FIGCRAFT_E2E_GUEST_PASSWORD` in the test runner environment.

The host accounts for retained publication capacity in the same transaction as the listing and its grants. On Vercel it uses the platform ingress address. Other hosts currently share the loopback budget. The optional server-side `FIGCRAFT_MAX_FILES`, `FIGCRAFT_MAX_FILES_PER_IP`, `FIGCRAFT_MAX_MB_PER_IP` and `FIGCRAFT_MAX_TOTAL_MB` settings override the native defaults of 1,000, 20, 256 MiB and 10,240 MiB. All workers serving the same database should share these settings. Files created before usage tracking are measured from their immutable archives on the next publication. Only the global quota can be reconstructed for these files.

The server admits ten new public-host publications per hour per address by default, with the native wider-block multipliers and 32 times that rate across the host. Set `FIGCRAFT_PUBLISHES_PER_HOUR` to override it. To check the limit in the editor, start the local production preview with this setting at 1 and run `FIGCRAFT_E2E_HOURLY_LIMIT=1 npx playwright test --grep 'hourly publication limit survives' --workers=1` against a fresh local admission budget. After the first file, a second publication receives HTTP 429. Removing the first file does not reset the hourly allowance. An acknowledgement retry on the first file still succeeds before removal.

For cumulative browser regression, restart the idle local Figcraft database after the dedicated hourly-limit check and start the production preview with `FIGCRAFT_PUBLISHES_PER_HOUR=1000`. This prevents unrelated fixture publications from exhausting the default ten-per-hour allowance. The default and one-per-hour behaviour are verified separately by the SQL and dedicated production checks. The rate override is server-side and does not change product defaults.

File expiry runs in PostgreSQL through pg_cron and pg_net. Public-host files default to 30 idle days. The first room open, final departure or a newer journal update extends the deadline. A live room survives a sweep. An operator-key file has no expiry. Unregistered immutable uploads have ten minutes to finalise before a sweep may reclaim them. A device with an unconfirmed upload retains its original bytes for retry.

After a local reset and bucket seed, run `node scripts/configure-local-retirement.mjs`. This configures the local gateway in Vault and runs an initial catch-up. On a hosted installation, provision Vault entries `figcraft_storage_api_url` (the project URL ending in `/storage/v1`) and `figcraft_storage_publishable_key` (the project's publishable key), then run `select figcraft_private.sweep_online_files();` as the database operator. The scheduled tasks run every ten minutes and at database startup. The delete request carries a capability valid for one immutable object. A lost or rejected request can be retried at the next sweep. Supabase documents how [pg_net queues and retains requests](https://supabase.com/docs/guides/database/extensions/pg_net).

Set the host idle period in seconds as the database operator. Zero keeps public-host files indefinitely. Existing committed deletion claims still finish, and abandoned uploads are collected independently.

```sql
insert into figcraft_private.online_retention_settings (singleton, idle_seconds)
values (true, 2592000)
on conflict (singleton) do update set idle_seconds = excluded.idle_seconds;
```

Run `node scripts/verify-local-retirement.mjs` on an empty local stack to test the installed schedule, actual Storage removal and recovery of a committed claim after a PostgreSQL restart. To exercise an interrupted browser publication through the real ten-minute staging interval, start the local production preview and run `FIGCRAFT_VERIFY_STAGING_CLEANUP=1 npx playwright test tests/e2e/preview.spec.ts --grep 'interrupted publication before server confirmation' --workers=1`. Allow up to 21 minutes for the next eligible sweep.
