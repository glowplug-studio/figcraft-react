# Native reference for the page background (upstream 481b6831, a45d932a, d9f52aab, 67c232ea)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: the checkerboard and the page row are native egui interface code, which the disposable `replay` oracle does not drive. The port's cases restate the native tests at that revision.

## Native tests restated

| Native test | Expected | Port case |
|---|---|---|
| `canvas::background::tests::translucent_pages_show_the_grid_without_applying_page_alpha_twice`, `the_canvas_draws_the_transparency_grid_for_a_transparent_page` | A page below full opacity draws a 2×2 checkerboard texture repeated every 16 points (8-point squares, anchored at the canvas's top left) behind the rendered page, whose pixels carry the page colour once; an opaque page draws no grid | Browser case "a translucent page draws over the themed checkerboard…": #FF000080 reads (255,0,0,128) on the canvas and, on screen, (255,127,127) over the white squares and (250,122,122) over the #F5F5F5 squares |
| `the_grid_updates_its_colours_when_the_theme_changes` | Light theme: panel #FFFFFF and canvas #F5F5F5, texels [panel, canvas, canvas, panel] | `transparencyGrid` in `page-background-field.ts`; the port has the light theme only |
| `field_tests::page_background_shows_fractional_opacity_like_fill_and_keeps_it_when_opening_the_picker`, `the_page_background_opacity_field_sets_the_page_colour_alpha` | #FF000080 shows 50.2%; the opacity field sets the alpha | `tests/parity/page-background-field.test.ts` and the browser case |
| `page_section` typed colour rule | A typed colour keeps the page's opacity unless it has 4 or 8 hex digits | Unit and browser cases |
| `page_background_colour_and_opacity_fit_a_resized_sidebar` | The hex and opacity share one row that grows with the sidebar | Not restated: egui layout geometry; the port's form fields follow its own sidebar layout |
