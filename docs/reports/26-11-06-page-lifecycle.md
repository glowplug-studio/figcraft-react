# Page lifecycle checkpoint — 6 November 2026

The full browser-relevant port remains **in progress**. This checkpoint covers page lifecycle for the existing Page/Rectangle model, not complete page/hierarchy/viewport parity.

## Scope, source and branch

Upstream inspected: `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. React revision: `6c988a50841a8e5bb0fdd8fabcadda17c547679f` on `prompt/full-figcraft-port`. The previous verified persistence checkpoint is `41d467b4bf96e71815d2669da59c421e89af46bd`. No push, main merge or deployment is claimed. The upstream commit is a source baseline; only the properties below are supported, not all upstream behaviour.

Implemented `page.add`, `page.select`, `page.rename`, `page.delete`, `page.duplicate`, `page.move` and `page.list`. [Pure reducer](../../src/engine/pages.ts) preserves default names, current-page background inheritance, target parsing, ordered query results and divider rules. Content edits are atomic and undoable; last ordinary-page deletion/division fails. Duplicating a supported page copies direct rectangles with fresh IDs, order, geometry and background. Invalid/unsupported child content is rejected rather than lost.

[Engine integration](../../src/engine/editor.ts) separates current-page navigation from dirty content and undo entries, restores transaction page/selection through history, retains monotonic u64 allocation and persists current-page projection through native files/recovery. A final correction keeps the u64MAX allocator serialisable after the last successful rectangle allocation and rejects the next creation atomically.

[Page controls](../../src/PagePanel.tsx) provide labelled add/select/rename/duplicate/delete/reorder actions, explicit dividers, focus handling for rename and narrow-screen access through [Editor](../../src/Editor.tsx). Move up/down is the browser substitute for upstream drag reorder; direct drag reorder is not implemented.

Source mappings: `crates/engine/src/cmd/page.rs:13–160`, `crates/doc/src/lib.rs` page/divider methods, `panels_behaviour_tests.rs:327–393`, `page_target_tests.rs`, `theme_pages_tests.rs` and `page_copy_navigation_tests.rs`, all under `original/figcraft`. Test fixtures in [pages.test.ts](../../tests/parity/pages.test.ts) are assembled from inspected definitions and assertions. Rust was not compiled or executed; no runtime-paired fixture is claimed.

## Supabase and browser substitutions

Existing scoped MCP verification found no public application tables. This slice needs no schema/migration, RLS, Storage, Realtime or hosted configuration changes. The existing provider-neutral Auth adapter passed real local integration tests. Host identity gates page mutations; local recovery remains IndexedDB under a principal key, not account-backed cloud document persistence.

Immutable nodes/maps and content-reference comparison keep navigation from dirtying content while the serialised current-page projection changes. Native files and recovery carry the page list, dividers, copies and current page. Unsupported resource/prototype/hierarchy content remains refused by the bounded codec. HTML forms/actions replace native menu controls; a Pages disclosure exposes navigation at narrow widths.

## Verification

Environment: Darwin arm64; Node 24.20.0; npm 11.19.0; Vitest 5.1.0; Playwright 1.65.0 Chromium against local production Next.js, desktop 1440 × 900 and narrow 390 × 844.

| Check | Result |
|---|---|
| `npm run typecheck` | Final pass |
| `npm test` | 190 pure tests passed; two opt-in integration tests skipped in pure run |
| `FIGCRAFT_LOCAL_INTEGRATION=1 npm run test:integration` | Two real local Auth integration tests passed |
| Package/Next.js production build | Final pass |
| Page reducer suite | 49 cases passed |
| Page-history suite | Five cases passed |
| Last u64 rectangle allocation regression | Passed in final pure suite |
| Authenticated local production Playwright | 10 passed, no skipped tests; 13.4 s |
| Rust/native runtime-paired page comparison | Not tested; source inspection only |
| Source-line coverage | Not measured |

Durable assertions: [page reducer](../../tests/parity/pages.test.ts), [page transactions/history/native round-trip](../../tests/parity/page-history.test.ts), [u64 export regression](../../tests/parity/file-commands.test.ts), [browser flows](../../tests/e2e/preview.spec.ts), [performance](../../tests/e2e/performance.spec.ts), [local Auth integration](../../tests/integration/supabase.test.ts).

The page browser workflow checks named page creation, divider insertion without navigation, duplication and visible copied layer, moving up, rename undo/redo, recovery after reload, 390 px navigation and absence of page errors. A separate case checks last-page deletion and divider rename failures preserve the page and do not add Undo. Existing Auth, native file, rendering/screenshot, pointer, resize, storage failure and 10,000-rectangle performance checks also passed in the ten-test run. These results include the final allocator correction. No hosted deployment or alternative browser engine was verified.

The [self-contained property report](26-11-06-page-lifecycle-parity.html) contains 52 rows: 44 Passed, 0 Failed, 1 Partial, 0 Blocked, 7 Not tested. Each row records upstream expectation, target, exact test identifier, expected/actual results, status, confidence, evidence, manual steps and remaining gap. A passing unsupported-content rejection is not feature implementation.

## Remaining parity and next action

Required gaps remain: page background editing/full colour support; guides; copied prototype settings, flows and navigation remapping; nested frames/groups and move-to-page world-coordinate preservation; viewport zoom-to-fit and related edit-state handling; drag reorder; complete native resources/history; account-backed persistence and the rest of the [master roadmap](../planning/26-11-06-complete-figcraft-port.md). The complete page family remains Partial and the full-port checkpoint must remain In progress.

Next: continue the remaining typed document/hierarchy/affine dependencies immediately. No user action is currently required. No publication gate has passed.
