# Incoming peer identity bounds

15 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `6818860`. **This bounded slice passes. The full port remains unfinished.**

## Implemented boundary

The provider-neutral [incoming reader](../../src/engine/sharing/live-presence.ts) retains the first 256 Unicode scalar values of names and 32 of colours. It preserves whitespace, controls, empty strings and arbitrary colour spellings. It stops at the retained prefix, rejects non-string values and rejects isolated UTF-16 surrogates within that prefix; Rust strings cannot contain those surrogates. It keeps the first 4,096 welcome entries, in order, without reading invalid trailing entries. Incoming identity decoding is separate from outgoing name cleaning, the 64-scalar outgoing name cap and the 1,024-byte signal limit.

[LivePeople](../../src/engine/sharing/live-people.ts) normalises initial, direct and reconnect welcomes, broadcast identities and self acknowledgements before retention. Existing peers can update at capacity, departures make room and self updates do not add self to the other-peer roster. Core stores a bounded initial snapshot and bound send/listen operations rather than a raw transport property. The [transport contract](../../src/engine/sharing/live-transport.ts) requires providers to bound their own retained welcome. The existing [browser provider](../../examples/nextjs/lib/sharing/browser-invites.ts) already reads before storing its grant; its initial/reconnect storage and previously returned transport views now inherit the bounded reader without an adapter product edit.

Bound operations preserve provider method receivers. They can therefore retain their receiver through a function closure: core cannot erase data independently owned by an arbitrary host. The structural core test verifies no ordinary raw transport/welcome property; it does not prove absence of references inside function closures. The separate browser-provider contract inspects actual grant storage and confirms the bundled provider replaces the raw roster. No claim of erasing arbitrary provider memory is made.

The [display helper](../../src/engine/sharing/peer-colour.ts) accepts exactly `#` plus six ASCII hexadecimal digits and otherwise uses native accent `#00875F`. [People controls and overlay](../../src/LivePeopleControls.tsx) use that derived colour for menu markers, following banners, pointers, selection outlines, carets and labels. Text contrast also uses the accepted RGB or fallback. Native contrast arithmetic uses f32: the helper rounds each weighted multiply/add with Math.fround rather than comparing JavaScript double precision directly. Independent primitive Rust probing found RGB (2,248,209) and (68,254,5) produce native luminance 170.00002 and dark text; grey 170 remains white. New fixtures and an expanded hostile-welcome browser assertion cover this numerical correction; all focused fixtures, the production build and final host Chromium pass. Bounded protocol colour strings remain unchanged in inspected state; CSS colour functions, named colours and resource strings are never interpreted as peer colours.

Direct welcomes also invalidate earlier in-flight acknowledgements, including same-generation receipts. Replacement of a presenter's generation clears obsolete spotlight-follow state while preserving an independent manual follow. These lifecycle corrections and the native-f32 contrast correction pass the focused/full pure tests and final production build.

## Native mapping and independent evidence

Native [join.rs](../../original/figcraft/crates/collab-net/src/join.rs), `bounded` and `take`, map to incoming identity readers, bounded welcome replacement and retained core state. [message.rs](../../original/figcraft/crates/collab/src/message.rs) supplies `MAX_PEERS = 4_096`. Native [client_cap_tests.rs](../../original/figcraft/crates/collab-net/src/client_cap_tests.rs) covers over-cap presence, updates/departure at capacity, long identities and replacement of the welcome passed to sync. Independent TypeScript fixtures translate these observable assertions and add scalar boundaries, supplementary Unicode, combining sequences, malformed values and retention inspection. Tests do not import or execute Rust.

Native [live/types.rs](../../original/figcraft/crates/engine/src/sharing/live/types.rs)::`parse_color`, [ui-egui/live.rs](../../original/figcraft/crates/ui-egui/src/live.rs)::`color`/`text_on` and [theme.rs](../../original/figcraft/crates/ui-egui/src/theme.rs)::`ACCENT` map to the display helper. Browser Canvas 2D substitutes for egui painting. Drawing replication transports archives/journals rather than the native welcome message; the browser grant and core snapshot are checked separately instead of introducing native wire coupling.

[Property matrix](26-11-15-incoming-peer-bounds-parity.html) · [Implementation plan](../planning/26-11-15-incoming-peer-bounds.md) · [Incoming parity](../../tests/parity/live-presence.test.ts) · [Core contracts](../../tests/contracts/incoming-peer-bounds.test.ts) · [Browser-provider contracts](../../tests/contracts/browser-peer-bounds.test.ts) · [Colour parity](../../tests/parity/peer-colour.test.ts) · [Chromium workflows](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `6818860`, native reference `bad07e44`; global supported baseline remains `8eb0b876` |
| Focused boundary checks | 23 passed across incoming parity, core lifecycle, browser-provider retention and native colour |
| Full pure suite | 4,713 passed in 53.35 seconds; 32 provider checks skipped in this invocation and verified separately |
| Real local provider integrations | 32 passed in 26.72 seconds during integration, before the final UI/direct-welcome corrections; provider and SQL source did not change afterwards |
| Strict types / production builds | Library, tests and Next.js host passed on final source |
| Final host Chromium | 256 passed in 699.007 seconds; no skips, retries, flakes or suite errors |
| Non-host Chromium | All 122 rendering/export/performance cases passed on the same production build in the retained full attempt |
| Combined browser coverage | All 378 cases covered across two results; not one green full invocation |
| Focused browser properties | Hostile welcome 4.7 seconds, including RGB/accent/f32 contrast and drawing sync; phone initial roster 2.7 seconds; view-only pointer/follow/spotlight 4.5 seconds |
| Scoped Supabase MCP | Successful read returned zero hosted public tables; no hosted write |
| Schema | No declaration or migration changed; prior empty replay of 448 SQL assertions and clean drift/advisers remain applicable |
| Fixture cleanup | All twelve counts zero: users, files, objects, links, connections, rooms, clients, batches, presence, peer names, retirements and team libraries |
| Local graph | React 8,436 nodes / 36,153 edges at 6818860; native 28,939 / 92,127 at bad07e44; combined 37,375 / 127,157. Known symbols from both sources verified. Unsupported extensions and data-only test modules require direct inspection. |

The 13-property HTML matrix was rendered in headless Chromium, has eleven columns per row, no page errors and resolving repository-relative evidence links. No manual human test is claimed. High confidence requires relevant parity and browser evidence; deterministic contract-only interleavings remain Medium.

## Verification corrections retained

The first unrestricted pure run alongside a production build reported four timeouts, including a quadratic retained-state assertion. That assertion now scans once with Set membership; no timeout was increased. Limited-worker full runs pass. Source review then identified pending direct-welcome receipts and obsolete presenter-follow state; their dedicated regressions pass. Native f32 contrast differs from JavaScript doubles at the threshold; independent Rust observations, pure fixtures and rebuilt Chromium now agree. Two early browser attempts were interrupted for these corrections rather than counted as passes.

The first completed cumulative attempt at 6818860 passed 131, failed one and serial-skipped 246. The publication dialog refused the owner-recovery fixture before it could exercise recovery: the coordinator omitted the documented `FIGCRAFT_PUBLISHES_PER_HOUR=1000` cumulative-test override. All 122 non-host cases passed in that attempt. After verifying zero fixture counts, the preview was stopped, only the idle local Figcraft database was restarted to renew ephemeral budgets, and the same build was restarted with the override. All 256 host cases then passed. Product defaults and the dedicated default/one-per-hour tests were not weakened.

Retained temporary result names: `fc-bounds-rate-limited-browser.json`, `fc-bounds-rate-limit-trace.zip`, `fc-bounds-final-host.json`, `fc-bounds-final-pure.log`, `fc-bounds-cleanup.log`. If unavailable, use the procedures below; these names do not replace durable findings in this report.

## Reproduction

From the checkout root:

```sh
npx vitest run tests/parity/live-presence.test.ts tests/contracts/incoming-peer-bounds.test.ts tests/contracts/browser-peer-bounds.test.ts tests/parity/peer-colour.test.ts --maxWorkers=2
npm test -- --maxWorkers=2
npm run typecheck
npm run preview:build
npm run test:integration
```

Use local Supabase and account fixtures from [setup](../setup.md). For cumulative verification, follow the admission-budget prerequisites in [supabase/README.md](../../supabase/README.md). From `examples/nextjs`, start the built preview with `FIGCRAFT_PUBLISHES_PER_HOUR=1000 npx next start --hostname 127.0.0.1 --port 3101`. Do not reset or restart the database during checks. Run from the root:

```sh
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts --workers=1 --retries=0 --grep 'hostile welcome|phone People menu|view-only phone sees a live pointer'
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0
```

The hostile welcome workflow intercepts an incoming roster and then uses real shared drawing edits. The separate browser-provider test uses mocked HTTP/monitor callbacks to inspect actual retained Grants. Neither claims live interoperability with native binary socket servers or thousands of physical browser connections.

## Continuation

The slice is complete at `6818860`; final production preview stopped cleanly. Continue [public collaboration diff](../planning/26-11-15-public-collaboration-diff.md), then readiness/missing-role branches and the remaining roadmap. No schema, migration, hosted resource, Vercel, branch push or main merge occurred. Native-only hosting/OS integration and user-deferred plugins remain outside this slice. Full browser parity and publication remain required.
