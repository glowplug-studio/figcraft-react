# Upstream delta row 2, item 13: the arrow-key pan

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `b374bfe`. **This bounded item passes. Six items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `75f54e0a` measured the target application and changed how far an arrow key pans the view when nothing is selected: 64 screen pixels a press, and five times that, 320, with Shift. It was 20 and 200. The [`view.pan`](../../src/engine/viewport.ts) command now uses the same two steps. The distance is in screen pixels, so it is the same at any zoom.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-arrow-pan.json](../../tests/fixtures/native-arrow-pan.json) | Twelve command sequences: each direction with and without Shift at 100%, one step on each axis at 200% and 50%, and several steps, limits and lenient values | All twelve match, receipt for receipt. All twelve failed before the change |

[Provenance and reproduction](../../tests/fixtures/native-arrow-pan.provenance.md).

## Earlier expectations changed

Two cases in `viewport.test.ts` pinned 20 and 200 screen pixels. They state 64 and 320 now and cite the fixture.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/view.rs::{PAN_STEP_PX,PAN_BIG_STEPS,pan}` | `viewport.ts` `view.pan` |

[Property matrix](26-11-21-arrow-pan-parity.html) · [Plan](../planning/26-11-21-arrow-pan.md) · [Pan parity](../../tests/parity/arrow-pan.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `b374bfe`, native reference `bad07e44` |
| Failing fixtures first | All twelve sequences failed before the change |
| Older expectations | Two cases, described above, changed on native observations |
| Full pure suite | 5,372 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 400 cumulative Chromium cases passed in one 16.2-minute run with zero skips, retries, flakes or suite errors: the 399 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 14.02 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,715 nodes/37,302 edges at `b374bfe`; native 28,939/92,127 at `bad07e44`; combined 37,654/128,259. `executeView`, `scrollView`, `PAN_STEP_PX` and `pan` verified. |

## Reproduction

```sh
npx vitest run tests/parity/arrow-pan.test.ts tests/parity/viewport.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The browser case runs at the zoom the editor opens with; other zooms are covered by the native sequences.
- Row 2 continues with item 14, zoom to selection.
