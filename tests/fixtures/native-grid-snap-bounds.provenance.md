# Native reference for layout snap bounds (upstream 1935c3ea, 9d486259)

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- No data file: snap lines are an internal of native's layout crate with no command that returns them, so the disposable `replay` oracle cannot observe them. The port restates the native test at that revision.

## Native test restated

| Native test | Expected | Port case |
|---|---|---|
| `layout::depth_tests::snap_lines_are_bounded_across_a_frames_grids` | A 4000 × 4000 frame with 1000 visible 1 px grids gives at most 200,000 snap lines, and more than 4000 each way | `tests/parity/grid-snap-bounds.test.ts`: one grid gives 4000 lines each way (native `grid_lines` stops at 4000); the thousand give 192,000, the 24 grids that fit when each is checked at two coordinates per line, as `grid_snap_lines_in` checks; the 25th and the rest are left out |
