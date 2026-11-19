# Upstream delta row 1, item 7: vector loops that close through a bridge, Flatten and mirror modes

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `239a20a`. **This bounded item passes. One further item of row 1, found in the same upstream range, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Three upstream changes to vector editing, ported as they stand at the pinned revision.

1. **A loop closes through a bridge (#1951; `8e6c342f`, `a75d8bf0`, `35d46208`, `153fa08d`, `06ffeca8`).** Draw a segment across a corner in vector edit mode, then delete the corner point. The region's loop was left open with the new segment in no loop, so the fill ran straight to a sharp point where the stroke was rounded. Now:
   - [`closingSegment`](../../src/engine/vector-network.ts) finds the one segment in no loop that joins an open loop's two ends.
   - [`roundedNetwork`](../../src/engine/vector-rounded.ts) walks it as the loop's last segment, so a file already saved in that state draws correctly.
   - [`deleteVertices` and `removeSegments`](../../src/engine/vector-edit-ops.ts) put it into the loop when they remove something, so new edits store the loop closed. The eraser removes segments through the same function.
2. **Flatten bakes a vector's point radii (#2195; `641cc415`).** [`flattenedNetwork`](../../src/engine/vector-commands.ts) takes a vector's network as the layer draws it. A rounded point becomes two points joined by a curve, no radius is left, and the box fits the baked geometry.
3. **A mirror mode smooths a sharp point (#2110; `eeb1f404`).** [`setMirroring`](../../src/engine/vector-edit-ops.ts) gives a point with two segments and no handles two handles on one line through it. With "angle" each handle is 0.3905 of its own segment; with "angle and length" both are 0.3905 of the shorter.

## Observable effects

- A corner cut off behind a bridge, then rounded, fills along its rounded outline, in new edits and in files saved before.
- Flattening a vector with rounded points keeps its look and leaves plain points.
- Choosing a mirror mode for a sharp point turns it into a smooth point.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-vector-loop-ops.json](../../tests/fixtures/native-vector-loop-ops.json) | 24 networks with native operations applied: the network after every operation, and the last network's fill, stroke and region paths as drawn | All 24 match: loops, segment ends and radii exactly, handles to nine decimals, drawn paths to seven. Before the change 17 of the first 22 disagreed |
| [native-vector-loop-sequences.json](../../tests/fixtures/native-vector-loop-sequences.json) | Nine editor command sequences with every receipt, the network after each stage and exported SVG | All nine match, with byte-identical SVG. The three Flatten cases with a radius failed before Flatten changed |

[Provenance, sources and reproduction](../../tests/fixtures/native-vector-loop-ops.provenance.md).

One native test is restated as a property, not an observation: a rounded chamfered rectangle is cut at every point however its loop lists and directs its segments (320 arrangements).

## One earlier expectation changed

An earlier port test expected a point whose two handles were both set back to zero to stay sharp under a mirror mode, the second handle then taking the first's length. With the upstream change that point is sharp again and is smoothed. The scenario was replayed through the native operations: both handles come out at 19.525, each 0.3905 of a 50-unit segment. The test now states the observed values and cites the fixture.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/vector.rs::{loop_index,loop_start,closing_segment}` | `vector-network.ts::{loopIndex,loopStart,closingSegment}` |
| `crates/doc/src/vector.rs::rounded_smoothed` loop rebuild | `vector-rounded.ts::roundedNetwork` |
| `crates/engine/src/canvas/vectoredit/ops.rs::close_bridged_loops`, in `delete_vertices` and `remove_segments` | `vector-edit-ops.ts::closeBridgedLoops`, in `deleteVertices` and `removeSegments` |
| `crates/engine/src/cmd/structure.rs::collect_flatten_parts` | `vector-commands.ts::flattenedNetwork` |
| `crates/engine/src/canvas/vectoredit/ops.rs::{smooth_sharp_point,set_mirroring}` | `vector-edit-ops.ts::{smoothSharpPoint,setMirroring}` |

[Property matrix](26-11-20-vector-bridged-loops-parity.html) · [Plan](../planning/26-11-20-vector-bridged-loops.md) · [Network parity](../../tests/parity/vector-loop-ops.test.ts) · [Sequences](../../tests/parity/vector-loop-sequences.test.ts) · [Browser](../../tests/e2e/vector-rendering.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `239a20a`, native reference `bad07e44` |
| Failing fixtures first | 17 of the first 22 network cases failed before the loop and mirror changes; three Flatten sequences failed before the Flatten change; the canvas pixel check failed without the loop changes |
| Older expectations | One, described above, changed on a native observation |
| Full pure suite | 5,099 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 386 cumulative Chromium cases passed in one 942-second run with zero skips, retries, flakes or suite errors: the 385 earlier cases and the new canvas pixel check. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.39 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,589 nodes/36,771 edges at `239a20a`; native 28,939/92,127 at `bad07e44`; combined 37,528/127,738. `closingSegment`, `closing_segment`, `closeBridgedLoops`, `close_bridged_loops`, `smoothSharpPoint` and `smooth_sharp_point` verified. |

## Reproduction

```sh
npx vitest run tests/parity/vector-loop-ops.test.ts tests/parity/vector-loop-sequences.test.ts tests/parity/vector-edit-ops.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
npx playwright test tests/e2e/vector-rendering.spec.ts --workers=1 --retries=0
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- Only single-layer Flatten was observed natively. The collector treats every vector part alike.
- The native case that draws a pentagon with the pen is not restated; the oracle replays commands, not pointer input.
- No case drives the eraser behind a bridge; it removes segments through the function that is tested.
- The same upstream range changes `vector.edit.position` (X and Y of several selected points; `6ac20c7d`, `8edcc02a`, `dc841f85`). No row of the delta queue named it. It is item 8 of row 1 and follows.
