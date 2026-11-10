# Supabase adapter

This directory contains local Supabase configuration, declarative schemas, generated migrations, functions and tests.

Database definitions belong in `schemas/`. With the current pg-delta workflow, generate versioned migrations with `supabase db schema declarative sync -f <description> --no-apply`, review the output, then apply and verify it against a local database before any remote change. Check the installed CLI version and command help first.

Supabase remains an interchangeable adapter behind provider-neutral contracts. `auth.users` is the identity source; public profile or application tables must use RLS and ownership-aware policies.

## Online file ownership

Reset the local stack with `supabase db reset --local` and apply the configured private bucket with `supabase seed buckets --local`. Run `supabase test db --local`, `npm run test:integration` and `supabase db advisors --local --type all`. For the signed-in host, set `SUPABASE_SECRET_KEY` in its ignored server environment. Its browser client uses only the publishable key. The server validates the uploaded drawing as the signed-in owner before using its privileged client to insert the listing. An immutable snapshot and its listing share the same deletion lifecycle.

Run `npm run preview:build`, start the production host on port 3100 and execute `npx playwright test tests/e2e/preview.spec.ts --grep 'signed-in ownership finalisation' --workers=1` to exercise the cookie-authenticated endpoint and confirm it refuses a foreign origin.

For the two-account publication and invitation check, run `npx playwright test tests/e2e/preview.spec.ts --grep 'published view and edit invites' --workers=1`. The local fixture provisions its own guest. For hosted verification supply a separate confirmed guest through `FIGCRAFT_E2E_GUEST_EMAIL` and `FIGCRAFT_E2E_GUEST_PASSWORD` in the test runner environment.
