# Delta row 3, item 12: Crop chosen in the paint picker

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `286bea3`: [report](../reports/26-11-24-picker-crop.md), [matrix](../reports/26-11-24-picker-crop-parity.html), [provenance](../../tests/fixtures/native-picker-crop.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `33612e9` on `prompt/full-figcraft-port`.
- Upstream commits: `bdf6ff92` (#2307), `8330ffb3`, `91a76c72`, `a54eafc0` (#2150). Ledger item 3.6.
- Files changed: `src/ImagePaintControls.tsx`, `src/engine/image-commands.ts` (`pickerCropTarget`); tests `tests/parity/picker-crop.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; provenance `tests/fixtures/native-picker-crop.provenance.md`.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Blockers: none.

## Native contract

- **`colorpicker.rs::crop_on_canvas`** (8330ffb3, a54eafc0): Crop chosen in the image mode menu runs `image.crop {ids:[id], index}` for one layer's own image fill as the Fill section shows it (a text's shared character fills included). The picture keeps its place and crop mode takes the canvas, closing the picker. For a stroke, several layers, a region's fill in vector edit mode or a style, Crop only sets the paint's mode and the picker stays.
- **`canvas/handles.rs::crop_dragging`** (bdf6ff92): with the picker open on a Crop-mode fill, a press on the image is the picker's own control: the picker stays and the drag moves the crop, not the layer.
- **`EngineError::NoGesture`** (bdf6ff92): a preview after its gesture was committed is dropped silently.

## What the port had

The image mode select only set `scale_mode`, so Crop chosen in the picker never entered crop mode and the picture lost its place. The picker already left canvas presses alone and drew crop handles for a Crop-mode fill, so the #2307 drag already moved the crop; the canvas checks `engine.interacting` before previews, so no gesture error reaches the user.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `ui-egui/src/widgets/colorpicker.rs::{crop_on_canvas, image_controls}` | `image-commands.ts::pickerCropTarget`, `ImagePaintControls.tsx` image mode select | Unit case over every target; browser case |
| `ui-egui/src/canvas/handles.rs::crop_dragging` | `PaintPicker.tsx` outside-press rule, `image-crop-interaction.ts` | Browser case (already matching) |
| `engine/src/error.rs::NoGesture` | None needed: previews are guarded by `engine.interacting` | Browser case checks no editor alert |

## Acceptance

- The browser case fails before the change (the picker stays open) and passes after; the unit case covers each target native lists.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
