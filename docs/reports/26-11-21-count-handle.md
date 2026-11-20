# Upstream delta row 2, item 8: the Count handle of polygons and stars

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `4a89d45`. **This bounded item passes. Eleven items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `89d8b50e` and `d773ab29` gave polygons and stars a Count handle on the canvas. [corner-handles.ts](../../src/engine/corner-handles.ts) ports it.

- **Where it is.** A selected polygon or star shows the handle on its first point clockwise from the top: a polygon's second vertex, a star's second outer point. It sits on the point itself, after the radius handle and a star's ratio handle.
- **What a drag does.** The point count becomes round(360 / angle), the pointer's clockwise angle from the top about the centre, measured in the shape's own frame on the circle its box maps from, and kept between 3 and 60. A pointer on the centre gives 60. The distance from the centre does not matter.
- **How it is written.** Through `node.set pointCount`, previewed during the drag and committed as one undo step. The readout by the handle reads `Count N`.

Before, the count could be set in the Points panel only.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-count-handle.json](../../tests/fixtures/native-count-handle.json) | Ten recorded sessions with 34 handle drags: the handles and their positions, the count after each drag, the readout while held and the undo depth | All ten match. All ten failed before the change: the port showed no Count handle |

[Provenance and reproduction](../../tests/fixtures/native-count-handle.provenance.md).

The oracle gained two steps for this item, one that lists the shape handles native shows and one that drags a named handle from where native shows it. The port's [replay harness](../../tests/support/native-session.ts) gained the same two, driving `CornerInteraction`. With the additions the oracle reproduces the earlier marquee sessions byte for byte.

## One screenshot baseline changed

`polygon-star-smoothed.png` shows a selected polygon. It now carries the Count handle's dot on the polygon's first point clockwise from the top; the difference image showed that dot and nothing else. The baseline was regenerated. This is the first changed baseline of the run, and it changed because the canvas draws one more handle.

## One earlier expectation changed

A port test listed a star's handles as radius and ratio and a polygon's as radius. Native lists the Count handle after them; the test states that now and cites the fixture.

## Recorded differences

- **The fifteenth digit of a dragged radius.** In one session a radius handle drag gives 9.82121375612608 where native gives 9.821213756126085. The radius drag predates this item. Receipts in this test compare to nine decimals.
- **The readout is drawn on the canvas.** Its text is not in the page, so the label `Count N` is ported from the source and its value and position are checked through the same functions the label reads.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/canvas/shape_handles.rs::ShapeHandle::Count`, `count_point` | `corner-handles.ts` `CornerHandle` `"count"`, `countPoint` |
| `shape_handles.rs::count_at` | `corner-handles.ts::countAt` |
| `shape_handles.rs::{handles,drag,value}` | `corner-handles.ts::{cornerHandles,cornerDrag,cornerValue}` |
| The readout label | `corner-handles.ts::CornerInteraction.draw` |

[Property matrix](26-11-21-count-handle-parity.html) · [Plan](../planning/26-11-21-count-handle.md) · [Count parity](../../tests/parity/count-handle.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `4a89d45`, native reference `bad07e44` |
| Failing fixtures first | All ten sessions failed before the change |
| Older expectations | One handle list and one screenshot baseline, both described above |
| Full pure suite | 5,270 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 395 cumulative Chromium cases passed in one 16.0-minute run with zero skips, retries, flakes or suite errors: the 394 earlier cases and the new signed-in workflow. One screenshot baseline changed, as described above; no other pixel fixture or baseline did |
| Real local provider integrations | 32 passed in 13.57 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,697 nodes/37,246 edges at `4a89d45`; native 28,939/92,127 at `bad07e44`; combined 37,636/128,203. `countAt`, `count_at`, `countPoint`, `count_point`, `cornerHandles`, `cornerDrag` and `CornerInteraction` verified. |

## Reproduction

```sh
npx vitest run tests/parity/count-handle.test.ts tests/parity/polygon.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The readout's text, above.
- Hovering the handle was not observed; the press on it was, in every drag.
- A polygon's maximum was not measured by upstream in the target application; native keeps it at 60 like a star's, and so does the port's handle. The Points panel's field allows up to 120 and the engine keeps the count at 60, as before.
- Row 2 continues with item 9, the smart guide distance.
