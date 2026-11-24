# Upstream delta row 3, item 12: Crop chosen in the paint picker

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `286bea3`. **This bounded item passes. Six items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **Crop in the picker is Crop image.** [`pickerCropTarget`](../../src/engine/image-commands.ts) restates native `crop_on_canvas`: one layer's own image fill, a text's shared character fills included. When it gives a target, choosing Crop in the [image mode select](../../src/ImagePaintControls.tsx) runs `image.crop` for it, which keeps the picture's place, enters crop mode and closes the picker. Otherwise Crop only sets the mode, as before.
- **Already matching.** A drag on the image while the picker is open on a Crop-mode fill moved the crop and kept the picker before this change (#2307). The port guards every preview with `engine.interacting`, so native's `NoGesture` case has no counterpart.

## Native reference

The behaviour is in the native interface, which the replay oracle does not drive; the port restates the four native interface tests ([provenance](../../tests/fixtures/native-picker-crop.provenance.md)).

| Case | Result |
|---|---|
| Browser: two layers' fills, then Fit, Crop, a corner drag, Enter, and a drag with the picker reopened | Two layers only take the mode and keep the picker; Fit keeps the picker; Crop closes it with the crop Crop image makes of the fitted picture; the corner drag gives 150 by 75 with the crop scaled by 3/4 and its top left kept; the reopened picker's drag moves the crop with the layer in place and no editor alert. Failed before at the picker closing |
| Unit: `pickerCropTarget` over one image fill, a solid fill, a missing index, a style, a region, a stroke, two layers and the page | Only the single image fills give a target |

## Recorded differences

- **No native data file.** Engine results come from the port's `image.crop` and crop drag, verified against native in earlier slices.
- **Gesture message.** The port has no unguarded preview, so there is no message to drop.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/widgets/colorpicker.rs::{crop_on_canvas, image_controls}` | `image-commands.ts::pickerCropTarget`, `ImagePaintControls.tsx` |
| `crates/ui-egui/src/canvas/handles.rs::crop_dragging` | `PaintPicker.tsx`, `image-crop-interaction.ts` (unchanged) |
| `crates/engine/src/error.rs::NoGesture` | None needed |

[Property matrix](26-11-24-picker-crop-parity.html) · [Plan](../planning/26-11-24-picker-crop.md) · [Unit](../../tests/parity/picker-crop.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `286bea3`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before the change at the picker closing |
| Full pure suite | 5,517 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 416 cumulative Chromium cases passed in one 17.0-minute run at `286bea3` with zero skips, retries, flakes or suite errors: the 415 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 15.24 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,857 nodes/37,777 edges at `286bea3`; native 28,939/92,127 at `bad07e44`; combined 37,796/128,720. `pickerCropTarget`, `ImagePaintControls`, `startImageCrop`, `crop_on_canvas` and `crop_dragging` verified. |

## Reproduction

```sh
npx vitest run tests/parity/picker-crop.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "Crop chosen in the paint picker" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 3 continues with item 13, the text caret's colour.
