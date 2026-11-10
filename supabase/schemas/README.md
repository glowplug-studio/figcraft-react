# Declarative schemas

Add SQL schema declarations here. The pg-delta engine resolves dependencies; organise files for readability rather than execution order.

Generate versioned changes with `supabase db schema declarative sync -f <description> --no-apply` and review the resulting migration before applying it. Do not use `supabase db diff`, which ignores this declarative tree under pg-delta.

The local unsaved editor uses no application tables. Online files add owner-scoped listing metadata and policies for immutable private snapshots. Define the bucket in `supabase/config.toml`. Review generated role and column grants against the ACL tests in `supabase/tests/` before applying a migration.
