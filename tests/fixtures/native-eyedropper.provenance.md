# Native reference for the eyedropper (upstream 30767bd2, 0dac2311)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: the native eyedropper samples the canvas render through a pointer event, which the disposable `replay` oracle does not send. The port restates the native tests at that revision.

## Native tests restated

| Native test | Expected | Port case |
|---|---|---|
| `eyedropper_image_tests::the_eyedropper_picks_a_magnified_images_pixel_not_a_blend_with_its_neighbours` | A 9 × 9 image of #151B23 with a 1 px #3D444D line in column 4, at the origin: (4.5, 4.5) gives 3D444D and (2.5, 4.5) gives 151B23 at 2×, 8× and 20×; (4.5, 4.5) gives 3D444D at 1× | `tests/e2e/eyedropper.spec.ts` with `tests/fixtures/eyedropper.ts` (the image drawn and placed in the browser) |
| `cmd/view.rs` `edit.pickColor` and `canvas/tools/click.rs::eyedrop` | The tool; a pick fills the selection with the hex (or keeps it with `apply: false`), says `Picked #RRGGBB` and returns to Move | `tests/parity/eyedropper.test.ts`; browser case "Pick color with I…" |
