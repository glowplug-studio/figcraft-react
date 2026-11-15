# Online server preference

15 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Verified React implementation `6d03c89`. This bounded slice passes; the full port remains unfinished.

## Implemented behaviour

The provider-neutral [preference model](../../src/engine/sharing/server-preference.ts) implements `pref.publishServer`: omitted or null `url` resets to the configured default, an empty string disables default online sharing, and other accepted strings retain their spelling after native Unicode trimming. Validation requires case-sensitive `ws://` or `wss://`, at most 500 UTF-8 bytes and no whitespace, control characters, query or fragment. Refusal preserves the saved snapshot and does not notify subscribers or persist a replacement. Command validation intentionally precedes destination parsing rather than replacing native checks with strict URL validation.

The [browser store](../../src/backends/browser/server-preference.ts) persists only the address under an account-scoped key. Missing or invalid legacy storage uses the host default; an explicit empty string remains off. Denied storage uses an account-isolated in-memory fallback. The [workspace](../../src/engine/workspace.ts) shares one preference across existing and new tabs without adding document edits or undo entries. The [Preferences field](../../src/OnlineServerPreferenceField.tsx) saves on blur/Enter, offers Reset when the saved value differs from the default, displays accessible validation errors and subscribes to command changes.

The [online workspace](../../src/engine/sharing/online-workspace.ts) resolves new default shares and bare codes through the selected configured adapter. Explicit supported publication/share destinations and invite links remain usable while the default is off. Existing live shares retain their transport and can still change access or stop sharing. An unsupported destination refuses before staging or network requests; no arbitrary server proxy is introduced. Adapter-specific operator keys remain attached to their destination, including established HTTP/WebSocket address equivalence. Explicit `collab.publish` still requires its own server.

The publication dialog's last address is held only for this run and starts empty, independently of the saved preference. The latest integration correction binds direct secondary-adapter publications and replacements to their actual invitation host and releases the previous transport. The direct A → B → A regression and integrated checks pass.

## Native mapping and browser substitutions

Native [cmd/view.rs](../../original/figcraft/crates/engine/src/cmd/view.rs), [prefs.rs](../../original/figcraft/crates/engine/src/prefs.rs) and [sharing/live/types.rs](../../original/figcraft/crates/engine/src/sharing/live/types.rs) map to the reusable model, editor command and workspace preference. Native [host.rs](../../original/figcraft/crates/engine/src/sharing/live/host.rs), [join.rs](../../original/figcraft/crates/engine/src/sharing/live/join.rs), [dialogs.rs](../../original/figcraft/crates/ui-egui/src/dialogs.rs) and [live.rs](../../original/figcraft/crates/ui-egui/src/live.rs) map to routing, Preferences and explicit publication controls. Tests are independent TypeScript fixtures and do not execute or import the Rust implementation.

The authenticated browser host's configured Supabase endpoint replaces the native binary's public default. Account-scoped localStorage replaces desktop preference persistence. Online-off text does not suggest native LAN hosting: browser listening remains unavailable. Native local-code parsing remains available when a matching configured transport exists. Provider credentials, owner tokens and operator keys are excluded from this preference and drawing serialisation. A generated local migration corrects presence/file-removal lock order. No hosted write, deployment or Vercel verification was made for this slice.

## Verification checkpoint

All results below apply to implementation `6d03c89`, with the locally replayed presence lock-order migration. The first full browser attempt and its failure are retained separately below.

| Gate | Result |
|---|---|
| Pure suite | 4,698 passed; 31 provider cases skipped in that invocation, then verified separately with the added concurrency case |
| Scoped Supabase MCP | Read succeeded; hosted public tables remain empty. No hosted mutation. |
| Real local provider integrations | 32 passed in 28.02 seconds, including the deterministic old-database failure/new-database success |
| Local schema replay and SQL | Reset from empty; 448 assertions passed |
| Schema drift and advisers | No changes; no findings |
| Strict types and production builds | Passed for library, tests and Next.js host |
| Focused Chromium | 4 passed in 14.9 seconds: preferences at desktop/390 px, independent publication address memory, explicit joins whilst off and both interrupted-publication recoveries |
| Cumulative Chromium | Final 255 host cases passed in 718.180 seconds with zero skips, retries, flakes or suite errors. All 122 non-host cases passed on the same production UI build in the preceding full attempt. All 377 cases are covered across these two results; this is not one green full invocation. |
| Fixture cleanup | All twelve counts zero: users, files, stored objects, links, connections, rooms, clients, batches, presence allocations, peer names, retirements and team libraries |
| Local graph | React 8,417 nodes / 36,077 edges at 6d03c89; native 28,939 / 92,127; combined 37,356 / 127,087. Both OnlineServerPreference and native join_target are present. SQL/configuration and data-only files require direct inspection. |

[Property matrix](26-11-15-online-server-preference-parity.html) · [Model parity checks](../../tests/parity/server-preference.test.ts) · [Browser persistence contracts](../../tests/contracts/browser-server-preference.test.ts) · [Publication command contracts](../../tests/contracts/online-publication-commands.test.ts) · [Adapter routing contracts](../../tests/contracts/server-preference-routing.test.ts) · [Chromium workflows](../../tests/e2e/preview.spec.ts).

The new Chromium identifiers are `online server preferences persist off, reject invalid addresses and refuse unsupported destinations without forwarding keys` and `an off default allows explicit publication and joins whilst an existing share remains operable`. They cover actual host persistence, refusal and request observation; they do not establish live interoperability with two independently running server deployments. The A/B destination and key distinctions have contract fixtures in addition to these browser checks. No manual human session is recorded.

Reproduce focused checks from the repository root with `npx vitest run tests/parity/server-preference.test.ts tests/contracts/browser-server-preference.test.ts tests/contracts/online-publication-commands.test.ts tests/contracts/server-preference-routing.test.ts`, then run `npm run typecheck` and `npm run preview:build`. Against the authenticated local preview and local Supabase prerequisites in the [handover](../planning/26-11-07-full-port-resume.md), run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts --workers=1 --retries=0 --grep 'online server preferences|an off default'`. Do not reset the database during checks. Use the same production preview for `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` to reproduce the complete suite; `npm run test:integration` runs all provider cases.

## Continuation

The slice is complete at `6d03c89`. The production preview was stopped cleanly; local Supabase remains available. No hosted write, deployment, branch push or main merge occurred. Continue with the [incoming peer-bounds plan](../planning/26-11-15-incoming-peer-bounds.md), renewing upstream/MCP/local-graph preflight first. The global supported baseline remains `8eb0b876`; this report does not claim full-product parity with the newer reference.

## Cumulative regression correction

The first 377-case Chromium attempt passed 129, failed one and serial-skipped 247. All 122 non-host cases passed on the production UI build; the seven passing host cases include both new preference workflows. The interrupted-publication recovery case failed on cleanup with HTTP 503. Local PostgreSQL reported SQLSTATE 40P01 between file removal and `live_participants`: a subsequent presence request could acquire child locks without first locking its file.

The [declaration](../../supabase/schemas/42_live_presence.sql) and [generated migration](../../supabase/migrations/20261115045709_presence_file_lock_order.sql) take the file key-share lock for every presence request, keeping the room update lock limited to initial registration. Authority, policies, grants and response shapes are unchanged. The new deterministic integration `takes the file lock before child grants on an already registered presence sample` failed on the old local database with `completed without file lock`, proving the missing ordering. It holds the file in one transaction, observes the second transaction's wait and checks that child locks remain available to the first. All child processes and transactions are cleaned up.

The migration was reviewed as one `CREATE OR REPLACE FUNCTION`, replayed from empty locally, and all 448 SQL assertions passed. All 32 provider integrations, advisers/drift and the final 255-case host browser run passed after the correction. Expanded browser assertions also cover a 390 px preference control and reopening the independently remembered publication address.
