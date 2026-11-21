# Delta row 2, item 9: the smart guide distance

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `a204eae`: [report](../reports/26-11-21-snap-distance.md), [matrix](../reports/26-11-21-snap-distance-parity.html), [provenance](../../tests/fixtures/native-snap-distance.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `35c94c4` on `prompt/full-figcraft-port`.
- Upstream commits: `a1980463`, `ebe0a8c2`. Ledger item 2.13.
- Files landed: `src/engine/snapping.ts`, `move-interaction.ts`, `transform-interaction.ts`, `draw-interaction.ts`, `vector-point-snap.ts`; tests `tests/parity/snap-distance.test.ts` (new), `snap-priority.test.ts`, `tests/support/native-session.ts`, `tests/e2e/preview.spec.ts`; fixture `native-snap-distance.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Upstream measured the target application: a dragged object's edge snaps to another's at a gap of 4.4 screen pixels and not at 4.6, at 100% and at 200% zoom. `SNAP_PX` in `crates/engine/src/canvas/tools/handles.rs` is therefore 4.5, where it was 5.

- The object snap uses it: a move (`tools/drag.rs`, with the equal-spacing snap), a resize (`tools/drag.rs`), a drawn shape (`tools/draw.rs`) and dragged vector points (`vectoredit/point_snap.rs`).
- Ruler guides (`canvas/snap.rs::snap_guide`) and the rotation origin (`canvas/rotation_origin.rs`) keep 5 as `UNMEASURED_SNAP_PX`.

## What the port had

The literal `5 / zoom` at the four object-snap call sites.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `tools/handles.rs::SNAP_PX` | `snapping.ts::OBJECT_SNAP_PX` | 52 native sessions in `native-snap-distance.json` |
| `tools/drag.rs` move, `snap_move` | `move-interaction.ts` `snapMove` | The move sessions; signed-in browser workflow |
| `tools/drag.rs` resize, `snap_point` | `transform-interaction.ts` `snapPoint` | The resize sessions |
| `tools/draw.rs`, `snap_point` | `draw-interaction.ts` `snapPoint` | The draw sessions |
| `vectoredit/point_snap.rs`, `snap_points` | `vector-point-snap.ts::VectorPointTargets.snap` | The vector point sessions |
| `canvas/rotation_origin.rs`, `UNMEASURED_SNAP_PX` | `rotation.ts` (5, unchanged) | Existing browser case for the rotation origin |

## Hazards and known differences

- The replay harness now offers a drag to the port's interactions in the order the canvas does (vector points, shape handles, transform handles, the draw tool, then move and marquee). The earlier session fixtures still pass.
- One older port test used numbers chosen for a 5 pixel radius. Its rule, that the pointer is rounded before the capture radius is tested, is unchanged; its numbers move to fit 4.5.
- The port has no ruler-guide snapping to change.

## Acceptance

- All 52 native sessions match.
- A signed-in browser workflow shows a move that stays at 5 pixels and snaps at 4.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
