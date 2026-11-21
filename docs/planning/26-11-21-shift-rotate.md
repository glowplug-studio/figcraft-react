# Delta row 2, item 10: Shift while rotating

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `2c776c2`: [report](../reports/26-11-21-shift-rotate.md), [matrix](../reports/26-11-21-shift-rotate-parity.html), [provenance](../../tests/fixtures/native-shift-rotate.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `5c68c88` on `prompt/full-figcraft-port`.
- Upstream commits: `a1ac22f1`, `da81d55a`. Ledger item 2.14.
- Files landed: `src/engine/rotation.ts`, `transform-interaction.ts`; tests `tests/parity/shift-rotate.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-shift-rotate.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Upstream measured the target application: a layer at 7 degrees, Shift-rotated by its corner, ends at 15, so Shift lands the rotation on a multiple of 15 degrees and does not step the turn by 15 from where the drag began.

- When a rotate drag begins, native keeps the rotation the selected layers share on the page (`tools/handles.rs::shared_rotation_degrees`): the angle every layer has, flips counted by their axis, or 0 when the layers differ or lie on the page's axes.
- With Shift the turn becomes `base - round((base - turn) / 15) * 15` (`tools/drag.rs`), so the rotation on the page is a multiple of 15.
- The shared rotation is the one on the page, so the rule holds for a layer inside a rotated frame or group.
- Layers with different rotations have base 0: Shift steps the turn, as before.

## What the port had

`transform-interaction.ts` rounded the turn: `angle = round(angle / 15) * 15`. By that rule a layer at 7 degrees turned by 37 with Shift ends at 37.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `tools/handles.rs::{shared_rotation,shared_rotation_degrees}` | `rotation.ts::sharedRotationDegrees` | 20 native sessions in `native-shift-rotate.json` |
| `tools/drag.rs` `Gesture::Rotate { base }` and the Shift rounding | `transform-interaction.ts` gesture `base` and the Shift rounding | The same sessions; signed-in browser workflow |

## Hazards and known differences

- `selectionFrame` in `rotation.ts` already decides whether several layers share an angle, with the same tolerance, for the handle box. The new function repeats that test for one or more layers and returns degrees, as native's two functions do.
- The existing browser case for Shift rotation starts at 0 degrees and is unchanged.

## Acceptance

- All 20 native sessions match.
- A signed-in browser workflow shows a layer at 7 degrees landing on -30 with Shift, and a free turn without.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
