# Sharing roles a share cannot give

19 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `b252585`. **This bounded slice passes with one recorded scope limit. The full port remains unfinished.**

## Implemented boundary

An active share can lack a link for a role: an older server hands out no comment link, and a share made before comment links has none. Native keeps such a share usable and refuses only the missing role. The React port previously switched to any role and showed all three choices.

- [share-access.ts](../../src/engine/sharing/share-access.ts) holds the one shared rule. `missingShareLink` returns the exact native bad-parameters error when a group of links exists and has no link for the requested role. A missing join code is not a missing link. A file that is not shared at the moment has no group to check.
- [OnlineWorkspace](../../src/engine/sharing/online-workspace.ts) applies it in the already-live owner branch of `collab.share`, after reusing or re-creating the group and before the selection changes. A refusal leaves the document, session, selected role, links and codes as they were. Omitted access keeps the selection. Nothing is published twice and no replacement group is requested.
- [OwnerShareSummary](../../src/backends/online-files.ts) gains the optional `available` roles: the roles with an actual link. Adapters that omit it are taken to offer the roles they report codes for.
- [OwnerShareControls](../../src/OwnerShareControls.tsx) offers only available roles, in native order (edit, comment, view), shows no selector when fewer than two remain, changes the visible role and code only after the host accepts the selection, and disables Copy code when the role has a link but no code. A share with an edit link and no join code still counts as shared, here and in the [Home list](../../src/OnlineFilesPanel.tsx).
- The bundled [browser adapter](../../examples/nextjs/lib/sharing/owner-sharing.ts) reports `available` from its retained links.

## Coordinator decisions recorded against the plan

1. **One guard, at the command, as in native.** The plan proposed also refusing inside the adapter's `selectAccess`. Native has no check below `collab.share`: its window filters the choices and dispatches the command. An adapter-level refusal would also change a first share that asks for a role its server does not hand out. Native records that role before any link exists and then shows no code for it; the port now does the same, and a contract pins it. The adapter setter is therefore unchanged, the command carries the check, and the controls cannot offer a missing role.
2. **The bundled device reader still accepts exactly zero or three grants.** The audit suggested reading a stored edit/view pair. No such record can exist: the reader has required zero or three entries since it was introduced at `d1e8352`, the bundled host has always issued three, and this port has never been published with sharing. Accepting a pair would add a stored shape nothing writes. A contract pins the rejection of every two- and one-entry record and of a two-link start receipt.
3. **Two-link evidence is provider-neutral.** The refusal, the offered roles and the unchanged selection are verified through a fake provider in contracts and through a mounted fixture in Chromium. That is evidence for any host adapter that returns a partial group. It is not evidence of network interoperability with an older native server, and no stored two-link record is claimed to load.

## Native mapping and independent evidence

Native [host.rs](../../original/figcraft/crates/engine/src/sharing/live/host.rs) `share` and `NO_COMMENT_LINK` map to `publishCommand` and `missingShareLink`. Native [types.rs](../../original/figcraft/crates/engine/src/sharing/live/types.rs) `Shared::of` and `SharedLink.code` supply link-versus-code. Native [ui-egui/live.rs](../../original/figcraft/crates/ui-egui/src/live.rs) `access_choice` maps to the filtered selector. Native `live_share_tests.rs` (`sharing_online_shows_the_code_copies_it_and_stops`, `a_server_with_comment_links_offers_a_comment_code`) supplies the two- and three-link expectations.

The fixtures restate the native error text and outcomes without importing product constants or native code. No Rust was executed; the native observations are source and test readings at the pinned revision.

[Property matrix](26-11-19-missing-share-grant-parity.html) · [Plan and source mapping](../planning/26-11-15-missing-comment-grant.md) · [Command contracts](../../tests/contracts/online-publication-commands.test.ts) · [Adapter contracts](../../tests/contracts/live-session-details.test.ts) · [Browser fixture](../../tests/fixtures/browser-online-directory.ts) · [Chromium workflows](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `b252585`, native reference `bad07e44`; global supported baseline remains `8eb0b876` |
| Failing fixtures first | Two command contracts and one adapter contract failed before the change; the three-link and reader-scope contracts already passed |
| Focused checks | 19 passed across the command and adapter contract files; all 171 contract cases passed after the library rebuild |
| Full pure suite | 4,796 passed in 26.08 seconds with four workers; 32 provider checks skipped in this invocation and verified separately |
| Strict types / production builds | Library, tests and Next.js host passed on final source |
| Focused browser | Share controls with two, three and one link passed in 3.0 seconds; the real three-role owner workflow passed in 3.4 seconds; the invite workflow, now asserting the three choices in native order on the real host, passed in 55.3 seconds |
| Cumulative Chromium | All 382 cumulative Chromium cases passed in one 995.553-second run with zero skips, retries, flakes or suite errors. |
| Real local provider integrations | 32 passed in 14.43 seconds after the cumulative browser run |
| Schema | No declaration, migration, API or credential-issuance change |
| Local Supabase | Local stack running with all 40 repository migrations applied; no hosted call |
| Fixture cleanup | All twelve counts zero: Auth users, files, stored objects, links, connections, rooms, clients, batches, presence connections, peer names, retirements and team libraries |
| Local graph | React 8,490 nodes/36,353 edges at `b252585`; native 28,939/92,127 at `bad07e44`; combined 37,429/127,340. `missingShareLink` and `access_choice` verified. Unsupported extensions and data-only test modules require direct inspection |

## Verification corrections retained

The publication fixture used by earlier command contracts marked a share as shared while every link stayed null, so it could not tell an available role from a missing one. It now issues a coherent group: each offered role has its own link, and an absent role has neither link nor code. The existing comment-selection assertion passes against real links.

Contract tests that load the example host resolve the package through its built output. Three of them failed once, on an undefined export, until the library was rebuilt; they are not product failures. Rebuild with `npm run build` before running contracts after changing a package export.

The first run of the new Chromium case failed on its own locator: the join-code output is also a status region. The locator now names the controls' message paragraph. No product change followed.

## Reproduction

From the checkout root:

```sh
npm run build
npx vitest run tests/contracts/online-publication-commands.test.ts tests/contracts/live-session-details.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview from `examples/nextjs` with `FIGCRAFT_PUBLISHES_PER_HOUR=1000 npx next start --hostname 127.0.0.1 --port 3101` and run, from the root, with `pdftoppm` on `PATH`:

```sh
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts --grep "Share controls offer only|owner sharing retries|published view and edit invites open" --workers=1 --retries=0
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0
npm run test:integration
```

Pass condition: every case passes with zero skips, retries or flakes; the two-link contracts report the exact native refusal and an unchanged session.

## Remaining gaps

- No older native server was contacted, and no stored two-link device record is supported (decisions 2 and 3).
- The Home list's `collab.files` receipt still derives `shared` from cached codes; a recorded share with links and no codes would list as not shared. The bundled host always issues codes. This is carried to the final audit.
- This closes the [collaboration command audit](../planning/26-11-15-collaboration-command-audit.md). The next work is the first row of the [upstream delta queue](../planning/26-11-15-upstream-delta.md).
