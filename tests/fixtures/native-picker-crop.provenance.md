# Native reference for Crop chosen in the paint picker (upstream bdf6ff92, 8330ffb3, 91a76c72, a54eafc0)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: the behaviour lives in the native egui interface, which the disposable `replay` oracle does not drive. The port's cases restate the native interface tests in `crates/ui-egui/src/crop_image_tests.rs` at that revision, with the engine results (`image.crop`'s placement crop, the crop after a corner drag) computed by the port's own `image.crop`, which earlier slices verified against native.

## Native tests restated

| Native test | What it checks | Port case |
|---|---|---|
| `crop_chosen_in_the_colour_picker_enters_crop_mode` (8330ffb3, 91a76c72) | Fit only sets the mode and keeps the picker; Crop runs `image.crop`: crop mode on fill 0, the picker closed, the crop equal to the one Crop image makes of the fitted picture; a bottom-right corner drag from (200,100) to (150,75) crops the layer to 150 by 75, the crop scaled by 3/4 with its top left kept, the layer still selected | Browser case "Crop chosen in the paint picker…" (the layer at (100,100)) |
| `crop_from_the_colour_picker_then_a_drag_on_the_image_moves_the_crop_not_the_layer` (bdf6ff92, #2307) | With the picker reopened on the Crop fill after crop mode ended, a drag on the image moves the crop; the layer keeps its place, size and selection; no "gesture" message | Same browser case, after Enter |
| `crop_in_the_colour_picker_only_sets_the_mode_where_crop_image_does_not_apply` (a54eafc0) | Crop for a stroke, two layers' fills or a region's fill only sets the mode and keeps the picker; `crop_on_canvas` gives nothing for a solid fill, an index with no fill, the page background and a style | Two layers in the browser case; every target in `tests/parity/picker-crop.test.ts` |
| `a_drag_whose_gesture_was_committed_under_the_button_shows_no_message` (bdf6ff92) | A drag continuing after its gesture was committed shows no message | No counterpart: the port's canvas checks `engine.interacting` before every preview, so the error native now names `NoGesture` never arises |
