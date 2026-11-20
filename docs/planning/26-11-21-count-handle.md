# Delta row 2, item 8: the Count handle of polygons and stars

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `4a89d45`: [report](../reports/26-11-21-count-handle.md), [matrix](../reports/26-11-21-count-handle-parity.html), [provenance](../../tests/fixtures/native-count-handle.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `ff70030` on `prompt/full-figcraft-port`.
- Upstream commits: `89d8b50e`, `d773ab29`. Ledger item 2.4.
- Files landed: `src/engine/corner-handles.ts`; tests `tests/parity/count-handle.test.ts` (new), `polygon.test.ts`, `tests/support/native-session.ts`, `tests/e2e/preview.spec.ts` and one screenshot baseline; fixture `native-count-handle.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

`crates/engine/src/canvas/shape_handles.rs`, measured by upstream in the target application on 12 November 2026.

- A selected polygon or star shows a Count handle on its first point clockwise from the top: a polygon's vertex 1, a star's outer point 1. It sits on the point, not inset, and is listed after the radius handle and a star's ratio handle.
- Dragging it sets the point count to round(360 / angle), where the angle is the pointer's clockwise angle from the top about the centre, on the unit circle the shape's box maps from, so it is measured in the shape's own frame. The count is kept between 3 and 60. A pointer on the centre gives 60.
- The value is written through `node.set pointCount`, one undo step per drag. The readout reads `Count N`.
- The handles show for one selected layer that is visible, unlocked and at least 48 screen pixels on each side.

## What the port had

`corner-handles.ts` gave polygons and stars a radius handle and stars a ratio handle. There was no Count handle; the count was set in the Points panel only.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `shape_handles.rs::ShapeHandle::Count`, `count_point` | `corner-handles.ts` `CornerHandle` `"count"`, `countPoint` | Ten native sessions in `native-count-handle.json` |
| `shape_handles.rs::count_at` | `corner-handles.ts::countAt` | The drag sessions, with the rounding boundaries |
| `shape_handles.rs::{handles,drag,value}` | `corner-handles.ts::{cornerHandles,cornerDrag,cornerValue}` | Handle lists, drags and readouts in every session |
| The readout `Count N` (`ui-egui/src/canvas/overlays.rs`) | `CornerInteraction.draw` | Source only: the label is drawn on the canvas |

## Hazards and known differences

- The replay harness gains `@shapeHandles` and `@dragHandle`, and the oracle the two matching steps. The extended oracle reproduces the earlier marquee sessions byte for byte.
- One screenshot baseline shows a selected polygon and so gains the handle's dot. It is regenerated; the difference image shows the dot and nothing else.
- An older port test listed a star's handles as radius and ratio, and a polygon's as radius. It changes on the native handle lists.
- One session's radius drag differs from native in the fifteenth digit of the radius. Receipts in this test compare to nine decimals.
- Section radius handles, recorded earlier for the final audit, are unchanged.

## Acceptance

- All ten native sessions match: handle lists and positions, counts after each drag, readouts, undo steps.
- A signed-in browser workflow drags the handle on a polygon and a star.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
