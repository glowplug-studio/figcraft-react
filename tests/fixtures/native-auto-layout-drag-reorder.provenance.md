# Native reference for the auto layout drag reorder (upstream cf567c3f, e415a3a0, #2142)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: the reorder happens in native's pointer drag (`Session::pointer`), which the disposable `replay` oracle does not send. The port restates the native tests at that revision through the same commands and its own move preview.

## Native tests restated (`crates/engine/src/al_drag_tests.rs`)

Three 60 × 60 rectangles in a row (or column), gap 20, at 0, 80 and 160 along the flow; one dragged by `by`, grabbed `grab` from its start edge.

| Native test | Expected order | Port case (`tests/parity/auto-layout-drag-reorder.test.ts`) |
|---|---|---|
| `a_child_dragged_right_passes_a_sibling_when_its_leading_edge_reaches_the_siblings_middle`, `where_the_child_is_grabbed_does_not_change_its_slot` | First child by 49, 50, 129, 130 (grabbed at 30 and at 10): 012, 102, 102, 120 | First case |
| `a_child_dragged_left_passes_a_sibling_by_its_left_edge`, `a_child_dragged_left_passes_the_second_sibling_one_pixel_later` | Third child by −49, −50, −129, −130: 012, 021, 021, 201 | Second case |
| `a_column_reorders_by_the_bottom_edge`, `a_column_reorders_at_the_boundaries_both_ways` | The same numbers in a column, both ways | Third case |
| `a_drag_with_no_move_along_the_flow_keeps_the_slot` | No move, and a drag across the flow only: unchanged | Fourth case |
| `several_dragged_children_use_their_combined_box` | The first two together by 49: 012; by 50: 201 | Fifth case |

The wrapping and grid drag tests of the same file (`wrap_drag_reorders_by_row_and_position`, `grid_drag_takes_the_cell_under_the_pointer`) are unchanged by these commits; the browser case "a child dragged in auto layout passes a sibling…" drags in the editor by 49 and 50.
