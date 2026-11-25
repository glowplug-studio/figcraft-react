# Roadmap row 16, item 6: tables

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `3a72456` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-table.ts` (new: `makeTable`, `editTable`, `tableAnswer`, `tableOf`, `spreadsheetCells`, `settleTables`); `src/engine/board-commands.ts` (`board.table`, `board.tableEdit`, the view's centre for a table placed without a position); `src/engine/editor.ts` (tables settled after each edit, fonts prepared for cell texts); tests `tests/parity/board-tables.test.ts`, fixture `tests/fixtures/native-board-tables.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`engine/src/boards/board_table.rs`)

- **board.table** `{rows?, columns?, cells?, x?, y?}`: a table of 3 × 3 by default, or the size of `cells`, at most 50 × 20, centred in the view when no place is given. It is made of:
  - a white frame named Table: 160 per column and 40 per row, radius 4, its outline in `#CFCBC4` drawn over the rows, clipping, hugging its rows;
  - rows of cells that fill their width with a line under each row but the last, the first row tinted `#F1EFEB`;
  - cells padded 10 and 12, at least 40 tall, each holding a 14-point text;
  - locked column lines laid over the table.
- **board.tableEdit** `{id?, action, index?}`: `addRow`, `addColumn`, `removeRow` or `removeColumn` at an index (default the last). A table keeps at least one row and one column; the column lines are drawn again. The answer is the table's rows, columns and cell texts.
- **Resizing**: a table resized by its height puts the change into its last row (or shares it over every row when its width changed too), and hugs its rows again.
- **Spreadsheet cells**: text copied from a spreadsheet (tabs between cells, a row per line, quoted cells) reads as cells, at most 50 × 20.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/boards/board_table.rs::{make_table, make_row, make_cell, restyle, parts, cell_texts, answer, table_cmd, edit_cmd, table_of}` | `board-table.ts`; `board-commands.ts` | Native observation |
| `board_table.rs::settle_resize` | `board-table.ts` `settleTables`; `editor.ts` | Parity test |
| `board_table.rs::spreadsheet_cells` | `board-table.ts` `spreadsheetCells` | Parity test |

## Acceptance

- Native's run (a default table, a table of given cells, rows and columns added and removed at indices, the refusals) is replayed with native's receipts and the same layers. Heights that hug text are left out, since native's headless engine measures none.
- Spreadsheet cells and the resize rule are restated.
- A browser case draws a table's header, column line and cells. It failed before (no tables).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
