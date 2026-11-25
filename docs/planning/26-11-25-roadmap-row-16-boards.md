# Roadmap row 16: boards

## Execution checkpoint

- Phase: items 1 to 3 complete through Phase 7 at `d722e71` and `9b457e5` ([stickies and shapes with text](../reports/26-11-25-board-shapes.md), [connectors](../reports/26-11-25-board-connectors.md)). Item 4 is next. Each item is opened with its own dated plan.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `792e207` on `prompt/full-figcraft-port`.
- Source: row 16 of the [master plan](26-11-06-complete-figcraft-port.md) and the `board.*` commands of the [command inventory](../parity/full-port-command-inventory.json) (21 listed; native also has `board.mindMap` and `board.mindMapAdd`, and `file.newBoard`).
- Native oracle: `$HOME/.cache/figcraft-oracle/project`; `replay` runs command sequences through the pinned engine and observes every engine command of this row.
- Next action: Item 4, reshaping and joined shapes (`engine/src/boards/board/{reshape,items}.rs`): `board.reshape`, `board.addConnected`, `board.nextSticky` from a shape.
- Blockers: none.

## What the port has

Nothing of boards. The file writer emits `board: null` on every layer and drops a document's kind, timer and votes; a board saved by native and opened in the port loses what its objects are for. Every item below starts from that.

## Native surface

- **Document** (`doc/src/board.rs`, 637 lines; `board_route.rs`, `board_mindmap.rs`; `facilitation.rs`): `FileKind` (design or board), `BoardItem` on a node (sticky, shape, connector, label, stamp, ink, table, mind node), the eight board colours and the board page colour, `BoardShape` (23 outlines with their text insets), `Stamp` (six marks), connectors (`Routing`, `Side`, `End`, `ConnectorPath`) and their routes, the mind map's layout, the facilitation timer and the ballots.
- **Commands** (`engine/src/boards/`, about 3,100 lines; `engine/src/cmd/facilitate.rs`): `board.sticky`, `board.nextSticky`, `board.shape`, `board.setColor`, `board.setStyle`, `board.label`, `board.connector`, `board.reattach`, `board.reshape`, `board.addConnected`, `board.stamp`, `board.ink`, `board.table`, `board.tableEdit`, `board.grid`, `board.template`, `board.templates`, `board.mindMap`, `board.mindMapAdd`, `board.timer`, `board.timerState`, `board.vote`, `board.voteResults`, and `file.newBoard`.
- **Interface** (`ui-egui`): the board tools and picker, connecting by drag, lines, table paste, the vote history and voters, the facilitation bar.
- **Tests**: engine `board_tests.rs` (22), `board_tables_tests.rs` (14), `board_mindmap_tests.rs` (13), `board_reshape_tests.rs` (12), `facilitate_tests.rs` (11), `board_connector_tests.rs` (10), `board_tools_tests.rs` (10), `board_table_paste_tests.rs` (6), `board_connected_tests.rs` (5), `board_grid_tests.rs` (2); doc `board_mindmap_tests.rs` (5), `board_shape_tests.rs` (4), `board_route_tests.rs` (3); UI `board_ui_tests.rs` (15), `board_connect_tests.rs` (10), `board_line_tests.rs` (3), `table_paste_tests.rs` (3), `board_picker_tests.rs` (2), the vote history and voters (2).

## Order

The data model comes first, since every command writes it and files carry it; then the engine commands, which `replay` observes, from objects that stand alone to the ones that join others; facilitation; then the interface.

| Item | Behaviour | Native files and tests | React files | Status |
|---|---|---|---|---|
| 1 | The board data model read and written: file kind, board items on layers, timer and ballots; `file.newBoard` with the board page colour | `doc/src/board.rs`, `facilitation.rs`, `lib.rs`, `node.rs`; `cmd/file.rs` | `document.ts`, `file-format.ts`, a new `board-data.ts` | Verified at `1bd2c6d` with native observations ([plan](26-11-25-board-data.md)) |
| 2 | Shapes and stickies: the 23 outlines and their text insets, `board.shape`, `board.sticky`, `board.nextSticky` (from a sticky), `board.setColor`, `board.setStyle`, a resized shape's text room, board commands refused on design files and prototyping refused on boards | `doc/src/board.rs` (`BoardShape`); `boards/board/{items,edit}.rs`; `board_shape_tests.rs`, `board_tests.rs` | new `board-commands.ts` | Verified at `d722e71` with native observations ([plan](26-11-25-board-shapes.md)) |
| 3 | Connectors: routing (straight, elbow, curved), sides and ends, labels and `board.label`, `board.connector`, `board.reattach`, re-routing when objects move, `setColor` and `setStyle` on connectors and ink | `doc/src/board_route.rs`; `boards/board/{connectors,derived}.rs`; `board_route_tests.rs`, `board_connector_tests.rs` | `board-route.ts`, `board-commands.ts` | Verified at `9b457e5` with native observations ([plan](26-11-25-board-connectors.md)) |
| 4 | Reshaping and joined shapes: `board.reshape`, `board.addConnected`, `board.nextSticky` from a shape | `boards/board/reshape.rs`, `tools.rs`; `board_reshape_tests.rs`, `board_connected_tests.rs` | `board-commands.ts` | In progress |
| 5 | Stamps and ink: the six stamps on the objects they sit on, marker and highlighter strokes | `doc/src/board.rs` (`Stamp`); `boards/board/tools.rs`; `board_tools_tests.rs` | `board-commands.ts` | Planned |
| 6 | Tables: `board.table`, `board.tableEdit`, pasting a table | `boards/board_table.rs`; `board_tables_tests.rs`, `board_table_paste_tests.rs` | `board-table.ts` | Planned |
| 7 | Grids and templates: `board.grid`, `board.template`, `board.templates` | `boards/board_grid.rs`, `board_templates.rs`; `board_grid_tests.rs` | `board-commands.ts` | Planned |
| 8 | Mind maps: `board.mindMap`, `board.mindMapAdd` and their layout | `doc/src/board_mindmap.rs`; `boards/board/mindmap.rs`; mind map tests | `board-mindmap.ts` | Planned |
| 9 | Facilitation: the timer and voting, `board.timer`, `board.timerState`, `board.vote`, `board.voteResults` | `doc/src/facilitation.rs`; `cmd/facilitate.rs`; `facilitate_tests.rs` | `facilitation.ts` | Planned |
| 10 | The board interface: tools and picker, connecting by drag, lines, table paste, the facilitation bar, vote history and voters; split when opened | `ui-egui/src/board*`, vote and table UI tests | `src/Board*.tsx` | Planned |

## Verification

Each item restates native's tests for what it ports and records native observations from `replay` with provenance where an engine command changes the document; the gates are the same as row 15's (pure suite, strict types, both builds, the cumulative browser gate, provider integrations once an hour apart, zero fixture counts, the local graph).
