# Native reference for the caret colour (upstream 2beec8b3, 06d03a54, 3cdc5f7e, 6920ea63, e3701d85)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: the caret is drawn by the native egui overlay, which the disposable `replay` oracle does not drive. The port's cases restate native `crates/ui-egui/src/canvas/overlays.rs` `caret_tests` at that revision, building each document with the port's own commands.

## Native tests restated

| Native test | Expected | Port case (`tests/parity/caret-colour.test.ts`) |
|---|---|---|
| `red_text_has_a_red_caret` | `caret_fill` at 2 is #FF0000 | First case |
| `light_grey_text_keeps_its_own_colour_whatever_is_behind_it` | #DDDDDD text inside a #222222 frame: #DDDDDD at 5 and 0 | First case |
| `the_caret_follows_the_run_of_the_character_before_it` | "ab cd", black, with 3..5 red: black at 2, red at 4, black at 0 | Second case (the run set by `text.style` `textFills`) |
| `the_caret_is_opaque_whatever_the_fill_opacity` | #336699 at paint opacity 0.2: alpha 1 | Third case |
| `gradient_or_missing_fills_have_no_fill_colour` | Gradient, no fill, hidden solid: none | Fourth case |
| `without_a_solid_fill_the_caret_contrasts_with_the_page` | Black on the default page; white after `page.setBackground #1E1E1E` | Fifth case |
| `without_a_solid_fill_the_caret_contrasts_with_the_frame_around_it` | White in a #222222 frame; black in #F0F0F0; black for #222222 at layer opacity 0.2; black for #22222233 | Sixth case |

The browser case in `tests/e2e/preview.spec.ts` draws the three outcomes (a red text, a gradient text on the page, a gradient text in a #222222 frame) and reads the caret's pixels.
