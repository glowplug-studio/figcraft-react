# Native reference for paint row copy and paste (upstream 375a7b8a, 33ac1d14, b640fbc1, 0ad70b95)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: the highlight, keys and system clipboard are native egui interface code, which the disposable `replay` oracle does not drive. The port's cases restate `crates/ui-egui/src/property_rows_tests.rs` at that revision; the engine commands they run (`fill.copy`, `fill.paste` and the stroke and effect pairs) were ported earlier.

## Native tests restated

| Native test | Port case |
|---|---|
| `a_click_on_a_fill_rows_background_highlights_it_and_the_keyboard_copies_and_pastes_it` | Unit 1; browser (click, Cmd/Ctrl+C gives `#FF0000`, Cmd/Ctrl+V on B on top, no layer) |
| `a_paste_replaces_the_highlighted_row_of_the_target` | Unit 2; browser |
| `a_stroke_row_copies_its_paint_and_settings`, `a_copied_stroke_goes_to_the_strokes_with_a_fill_row_highlighted` | Unit 3 |
| `an_effect_row_copies_and_pastes_its_effect` | Unit 4; browser (marker `figcraft://clipboard/effect`) |
| `without_a_highlighted_row_the_keyboard_copies_and_pastes_layers`, `copying_layers_after_a_fill_pastes_the_layers`, `text_copied_in_another_app_afterwards_pastes_as_text` | Unit 5; browser (a layer copy without a highlight) |
| `escape_lets_the_highlight_go_and_keeps_the_selection`, `a_highlighted_row_whose_paint_an_undo_took_away_goes` | Unit 6; browser (Escape) |
| `the_highlight_follows_its_row_when_rows_move_or_go` | Unit 7 |
| `a_paste_onto_several_layers_adds_the_fill_to_each_in_one_undo_step`, `a_paste_replaces_the_highlighted_row_on_every_selected_layer` | Unit 8 |
| `an_effect_copied_after_a_fill_is_what_pastes`, `a_property_copy_whose_engine_copy_is_gone_pastes_no_stale_layers` | Unit 9 |
| `programmatic_copy_and_paste_of_a_row_leave_the_system_clipboard_alone`, `a_programmatic_paste_after_a_property_copy_whose_engine_copy_is_gone_pastes_no_stale_layers` | Unit 10 |
| `a_press_elsewhere_lets_the_highlight_go`, `a_click_on_the_canvas_lets_the_highlight_go` | Browser (a press on the Appearance heading) |
| `a_click_beside_the_rows_controls_highlights_it_too`, `a_click_on_a_rows_grip_highlights_that_row_for_the_selection` | Browser (a click on the row's background); the effect row's drag strip carries `data-property-grip` |
| `edit_copy_from_the_menu_copies_the_highlighted_row`, `a_row_menu_copy_is_pasted_by_the_keyboard`, `a_property_copied_in_one_window_pastes_in_another_and_the_highlight_stays_in_its_window` | Not restated: the port's Edit menu Copy and the row menus' Copy keep their earlier paths, and the port has one window per tab |
