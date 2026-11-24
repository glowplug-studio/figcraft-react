# Delta row 3, item 17: the eyedropper

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `679e2d6`: [report](../reports/26-11-24-eyedropper.md), [matrix](../reports/26-11-24-eyedropper-parity.html), [provenance](../../tests/fixtures/native-eyedropper.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `ff743ce` on `prompt/full-figcraft-port`.
- Upstream commits: `30767bd2` (#2189), `0dac2311` (docs). Ledger item 3.12.
- Files changed: `src/engine/eyedropper.ts` (new), `src/engine/editor.ts` (`edit.pickColor`, the `eyedropper` tool, `pickColour`, `pickedColour`), `src/engine/canvas.ts` (the press), `src/Editor.tsx` (key I, Edit ▸ Pick color, the notice); tests `tests/parity/eyedropper.test.ts`, `tests/e2e/eyedropper.spec.ts` with `tests/fixtures/eyedropper.ts` (new), one case in `tests/e2e/preview.spec.ts`; provenance `tests/fixtures/native-eyedropper.provenance.md`.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Blockers: none.

## Native contract

- **`cmd/view.rs` `edit.pickColor {apply?}`** (Edit ▸ Pick color, key I): the eyedropper tool; `apply: false` (the colour picker) only samples.
- **`canvas/tools/click.rs::eyedrop`** (#2189): a press renders one screen pixel centred on the pointer as the canvas draws it (`magnified_image_pixels`), so a magnified image gives its own pixel; the colour, opaque, fills the selected layers (`node.set fill`), the message reads `Picked #RRGGBB`, and the Move tool comes back.

## What the port had

No eyedropper and no `edit.pickColor`; the row plan recorded it as not found.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/cmd/view.rs` `edit.pickColor` | `editor.ts` `edit.pickColor`, the `eyedropper` tool | Unit |
| `engine/src/canvas/tools/click.rs::eyedrop` sample | `eyedropper.ts::sampleCanvasColour` | Browser fixture restating `eyedropper_image_tests` |
| `eyedrop` result | `editor.ts::{pickColour, pickedColour}`, `canvas.ts` press, `Editor.tsx` notice | Unit; browser case |

## Deferred

The picker's eyedropper button, Cmd/Ctrl+Shift colour styles, recent colours, the cursor and the Mac's Ctrl+C key are recorded in the handover's deferred queue (row 19, from upstream delta row 3).

## Acceptance

- The restated native cases pass; full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
