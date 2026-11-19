# Delta row 1, item 7: vector loops that close through a bridge, Flatten and mirror modes

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `239a20a`: [report](../reports/26-11-20-vector-bridged-loops.md), [matrix](../reports/26-11-20-vector-bridged-loops-parity.html), [provenance](../../tests/fixtures/native-vector-loop-ops.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `0e58d0f` on `prompt/full-figcraft-port`.
- Upstream commits: `8e6c342f`, `a75d8bf0`, `35d46208`, `153fa08d`, `06ffeca8` (#1951); `641cc415` (#2195); `eeb1f404` (#2110).
- Files landed: `src/engine/vector-network.ts`, `vector-rounded.ts`, `vector-edit-ops.ts`, `vector-commands.ts`; tests `tests/parity/vector-loop-ops.test.ts` (new), `vector-loop-sequences.test.ts` (new), `vector-edit-ops.test.ts`, `tests/fixtures/vector-rendering.ts`, `tests/e2e/vector-rendering.spec.ts`; fixtures `native-vector-loop-ops.json`, `native-vector-loop-sequences.json` and their provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract at the pin

The upstream commits revised one another; the port follows the state at `bad07e44`, not any intermediate commit.

1. **An open loop draws through the segment that joins its ends.** `VectorNetwork::closing_segment(loop, index)` walks a loop strictly in order from `loop_start` (the end of its first segment that its second does not share). If the walk ends away from where it began, and exactly one segment in no loop joins those two points, that segment is the loop's closing segment. `rounded_smoothed` walks it as the loop's last segment, so the points at both ends are cut by arcs as the stroke's are. `loop_index` is built once per pass.
2. **Removing points or segments closes a bridged loop.** `ops.rs::close_bridged_loops` gives every loop its closing segment against one snapshot of the network and pushes it onto the loop's end, so the winding is kept. Two loops over the same chain, and two loops over different chains with the same ends, all take it. Only `delete_vertices` and `remove_segments` run it, and only when they removed something.
3. **Flatten bakes point radii.** `cmd/structure.rs::collect_flatten_parts` takes a vector's network as the layer draws it (`geometry::drawn_network(network, corners.smoothing)`): each rounded point becomes the arc's end points joined by curves, every radius reads 0 and the box is fitted to the baked geometry.
4. **A mirror mode smooths a sharp point.** `ops.rs::smooth_sharp_point` gives a point with two segments and no handles two handles on one line through it, along `(B - A) / |BA|² + (C - B) / |BC|²`. With "angle" each handle is 0.3905 of its own segment; with "angle and length" both are 0.3905 of the shorter. Open-path ends, points that already have a handle and coincident neighbours are left to the earlier rule.

## What the port had

Direct counterparts of every function, in the state before these commits: `roundedNetwork` rebuilt each loop without a closing segment, `reopenLoops` only rotated a broken loop to its break, `flattenedNetwork` used a vector's network as stored, and `setMirroring` left a sharp point sharp. `connectVectorPoints` already closed a broken loop through a new segment.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc::VectorNetwork::{loop_index,loop_start,closing_segment}` | `vector-network.ts::{loopIndex,loopStart,closingSegment}` | 24 native networks in `native-vector-loop-ops.json` |
| `doc::VectorNetwork::rounded_smoothed` loop rebuild | `vector-rounded.ts::roundedNetwork` | The same fixture's drawn loops and fill, stroke and region paths; `a_chamfered_rectangles_rounded_fill_is_cut_at_every_point` restated over 320 loop arrangements; canvas pixel check |
| `vectoredit::ops::close_bridged_loops`, called by `delete_vertices` and `remove_segments` | `vector-edit-ops.ts::closeBridgedLoops`, called by `deleteVertices` and `removeSegments` | The same fixture; four editor sequences in `native-vector-loop-sequences.json` |
| `cmd/structure.rs::collect_flatten_parts` | `vector-commands.ts::flattenedNetwork` | Four Flatten sequences |
| `vectoredit::ops::{smooth_sharp_point,set_mirroring}` | `vector-edit-ops.ts::{smoothSharpPoint,setMirroring}` | Eleven network cases and one editor sequence |

## Hazards and known differences

- A loop out of walking order has no closing segment and is left alone, in rounding and in removal alike.
- The 0.3905 factor is a measurement of the target application known to about three digits; the port copies the constant.
- The mirror change moved one earlier port expectation: a point whose two handles were both set back to zero is sharp again and is smoothed. The scenario was observed natively and the test states the observed values.
- Drawn paths agree with native to seven decimals, not nine: the rounded arcs go through arc-length trims.

## Found in the same upstream range, not part of this item

`6ac20c7d`, `8edcc02a` and `dc841f85` change `vector.edit.position`: with several points selected the X and Y fields show the shared value or Mixed, and a typed value sets every selected point's own coordinate, with `{add}`, `{mul}` and `{div}` forms. No row of the delta queue named it. It is added to the row 1 plan as item 8.

## Acceptance

- All 24 network cases and nine sequences match native; the restated property test passes.
- The loop, Flatten and mirror cases each failed before their change; the canvas pixel check failed without the loop changes.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, row 1 plan and delta queue.
