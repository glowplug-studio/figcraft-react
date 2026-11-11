# Owner rename and removal admission

Upstream `a2e87433`. Roadmap row 13. The native [admin budget test](../../original/figcraft/apps/figcraft-server/src/admin_budget_tests.rs) freezes the clock, renames a file 60 times, then refuses another mutation from the same address. A different address can still act. Reads spend nothing. The browser’s share-link and keyed-publication routes already use this budget.

1. Trace owner and operator authority through the [native dispatcher](../../original/figcraft/apps/figcraft-server/src/store/backend.rs), [browser file store](../../src/backends/supabase/online-files.ts), [retirement claims](../../supabase/schemas/30_online_retirement.sql) and the [existing shared budget](../../supabase/schemas/35_operator_publication.sql). Map listing changes, Storage visibility, retries and room revocation before editing.
2. Charge the trusted ingress address on Home rename and remove. Keep signed-in ownership checks and the existing native Unicode cleaning. Close direct Data API and Storage bypasses, including the race between staging, finalisation and deletion.
3. Make removal stop serving the listing and its live grants atomically. Retain a retryable claim on the exact Storage object if physical deletion fails. Verify a replacement object at the same path cannot be deleted by an old claim. Preserve private staging and account isolation.
4. Run deterministic local SQL boundaries, concurrent provider checks and a production Home workflow. Verify an exhausted owner can still browse and another address can manage its own file. Rebuild the local code graph and update the reports and handover. Continue to ordered collaboration.

**Checkpoint.** Usage and trust are verified at `1ac66bd` through the focused production workflow. The cumulative run uses the isolated local Figcraft database and preview. Apply schema changes after that run exits.
