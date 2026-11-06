# Declarative schemas

Add SQL schema declarations here. The pg-delta engine resolves dependencies; organise files for readability rather than execution order.

Generate versioned changes with `supabase db schema declarative sync -f <description> --no-apply` and review the resulting migration before applying it. Do not use `supabase db diff`, which ignores this declarative tree under pg-delta.
