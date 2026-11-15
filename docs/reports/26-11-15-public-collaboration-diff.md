# Public collaboration diff

15 November 2026 · Product `1253f41` · Native `bad07e4433240cad046589129c084bd2fc36f097`.

**The bounded slice passes at `1253f41`: all 380 cumulative Chromium cases passed in 933.894 seconds, with no skips, retries, flakes or suite errors. The full port remains unfinished.**

`executeAsync("collab.diff", {against:"undo"|"saved"})` returns the native externally tagged changes, count and version-prefixed postcard byte size. Undo is the default; live sessions refuse snapshot undo comparison and permit saved comparison, including view-only connections. The command is read-only and synchronous dispatch requires `executeAsync`. Public parameter checks accept global `id`/`ids`, reject other unknown keys together in scalar order and retain native coercion and error spelling.

A separate saved comparison document preserves existing dirty/download UX. Normal settled opens compare with themselves; recovery compares with a fresh name-matched document. Ordinary copies and branch heads start with themselves; offline copies compare with their unrenamed source. Acknowledgements advance only to the captured saved revision. Shared drawing preference is captured separately from a follower's locally displayed page before asynchronous save work. Historical previews likewise retain their raw version comparison document while the UI keeps its visible page. Comparison captures immutable documents before asynchronous image reads and leaves selection, history and preview state unchanged.

The shared postcard writer handles all six changes without changing initial-session APIs. Size is wire byte `1`, vector count and changes; no disk/session envelope is included. Empty vectors are two bytes. Numeric comment/devSnapshot keys use u64 encoding. Readable JavaScript receipts use numbers for safe integers and exact decimal strings outside the safe range, including nested JSON values. This explicit browser substitution preserves native integer digits; binary sizing retains canonical native tokens independently, including `1.0` versus `1`.

Native Debug escaping was checked against independent Rust 1.99.1 probes, including all valid scalars, combining marks, Hangul fillers and halfwidth exceptions. Runtime Unicode data can differ for newly assigned characters; the checked fixtures and pinned native behaviour do not prove compatibility with every future Unicode version.

[11-column property matrix](26-11-15-public-collaboration-diff-parity.html) · [Plan and source mapping](../planning/26-11-15-public-collaboration-diff.md) · [Public contracts](../../tests/contracts/public-collaboration-diff.test.ts) · [Wire parity](../../tests/parity/collaboration-diff-wire.test.ts) · [Engine fixture provenance](../../tests/fixtures/native-public-diff-engine.provenance.md) · [Wire fixture provenance](../../tests/fixtures/native-public-diff-wire.provenance.md).

## Verified checkpoint

- 4,782 pure checks and 15 public command contracts pass; 52 independent wire cases and 22 real native engine stages underpin the fixtures. The engine fixture includes nine intentional errors.
- Strict library, tests and Next.js host TypeScript checks pass. Library and production host builds pass.
- Two production Chromium workflows pass in 18.1 seconds: mounted local editor 3.8 seconds; live editor/view-link workflow 10.4 seconds. These individual durations exclude setup/teardown overhead.
- Cumulative Chromium: all 380 passed in one run (933.894 seconds), with zero skips, retries, flakes or suite errors.
- Refreshed Graphify at `1253f41` / native `bad07e44`: React 8,466 nodes / 36,264 edges; Rust 28,939 / 92,127; merged 37,405 / 127,262. `collaborationDiff` has seven verified edges and native `diff_cmd` five. Coverage gaps: 88 unsupported-extension files and data-only test modules.
- All 32 real local provider integrations passed in 18.57 seconds after cumulative browser verification. All twelve fixture counts are zero: Auth users, files, objects, links, connections, rooms, clients, batches, presence, peer names, retirements and team libraries.
- Scoped Figcraft Supabase MCP read succeeded with zero hosted public tables; no hosted write. No schema changes were made; prior schema replay/drift/adviser evidence remains applicable.
- The 15-row/11-column HTML matrix and local tracker rendered without page errors; all evidence links resolve. Tracker is approximately 61.6%; remaining active effort was reassessed at 18–42 hours, retained because the broad outstanding roadmap/audit dominates the uncertainty. The tracker remains uncommitted.
- Production preview stopped cleanly; local Supabase remains running. No build/browser/test processes from this slice remain active.
- No schema changes or hosted writes were made for this slice. Native source and temporary generators are reference tools, never product/build/runtime-test dependencies.

The local browser workflow mounts the editor and checks visible layers, Undo/Redo controls, acknowledged saves and read-only controls. The live workflow uses detached editor clients with real local publication/join and live history: it proves live undo refusal and non-mutating saved receipts for editor and view-link clients. It does not prove those clients' mounted live UI, or establish mounted live UI coverage on its own. The complete cumulative suite passed separately. No manual human test is claimed.

## Reproduction and manual bridge

Run the focused commands from the canonical repository with installed dependencies:

```sh
npx vitest run tests/contracts/public-collaboration-diff.test.ts tests/parity/collaboration-diff-wire.test.ts
npx tsc -p tsconfig.tests.json --noEmit --pretty false
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts --workers=1 --retries=0 --grep 'public diff commands'
```

Browser prerequisites: the production preview and local Supabase/account fixtures described in the [resume handover](../planning/26-11-07-full-port-resume.md). The two cases are local-fixture tests and are excluded when `PLAYWRIGHT_BASE_URL` is supplied. Use the established fixture bootstrap in `preview.spec.ts::loadEmbeddedOnlineEditor`; it exposes `window.FigcraftDirectory` from [browser-online-directory.ts](../../tests/fixtures/browser-online-directory.ts). Do not introduce a production inspection API or reset the database to run this check.

For an optional human check, load that same fixture and obtain a client with `FigcraftDirectory.publicationEditor(principal, server, publicAnonKey)` using the local test account/public configuration. Call `client.mount()`, then `await client.command("collab.diff", {against:"saved"})`: expect `{changes:[],count:0,bytes:2}`. Create the rectangle using `client.command("shape.rectangle", {x:0,y:0,width:10,height:10})`, then call the default diff: expect one rectangle create, count 1 and bytes 56. Compare `client.state()` before/after, visible layer count and Undo/Redo controls. Save/acknowledge using the exact automated sequence in the linked browser case, repeat saved comparison and call `client.close()` afterwards. Expected results are reproducible instructions; no human execution result is recorded.

## Pause and continuation

The user requested wind-down after active work. Implementation is committed at `1253f41`; reports and the paused [handover](../planning/26-11-07-full-port-resume.md) accompany it. The next eligible implementation is [presence readiness](../planning/26-11-15-presence-readiness.md), followed by [missing-comment-grant compatibility](../planning/26-11-15-missing-comment-grant.md). Both are source-analysis plans only. No next-slice implementation, hosted write, Vercel action, branch push or main merge was performed.

Temporary result names: `fc-public-diff-full-browser.json`, `fc-public-diff-full-browser.log`, `fc-public-diff-pure-final.log`, `fc-public-diff-types.log` and `fc-public-diff-build-release.log`. Durable results above remain the checkpoint; rerun the documented commands if temporary files are absent. For the full browser run, build with `npm run preview:build`, start the production preview from `examples/nextjs` using `FIGCRAFT_PUBLISHES_PER_HOUR=1000 npx next start --hostname 127.0.0.1 --port 3101`, and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0`. Keep `PLAYWRIGHT_BASE_URL` unset for local fixtures. Do not reset/restart the database during checks.
