# Declarative schemas

Add SQL schema declarations here. The pg-delta engine resolves dependencies; organise files for readability rather than execution order.

Generate versioned changes with `supabase db schema declarative sync -f <description> --no-apply` and review the resulting migration before applying it. Do not use `supabase db diff`, which ignores this declarative tree under pg-delta.

The current rectangle slice declares only the existing public namespace in `00_public.sql`; it adds no application tables. This explicit declaration lets pg-delta verify a no-op design without its empty-input safeguard rejecting the directory. Auth-managed schemas are excluded from application declarations.
