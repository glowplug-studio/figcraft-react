# Roadmap row 16, item 6: tables

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `6b0e410`. **This bounded item passes. Items 7 to 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Boards hold tables as native's do ([`board-table.ts`](../../src/engine/board-table.ts), [`board-commands.ts`](../../src/engine/board-commands.ts)):

- **board.table** makes a table of auto layout rows of cells with text, a tinted header and locked column lines, of a given size or from given cells.
- **board.tableEdit** adds and removes rows and columns at an index, and redraws the column lines.

A table resized by its height puts the change into its rows and hugs them again. Text copied from a spreadsheet reads as cells, ready for pasting.

## Evidence

| Case | Content | Result |
|---|---|---|
| Native observation | A default table, a table of given cells, rows and columns added and removed at indices, the refusals ([provenance](../../tests/fixtures/native-board-tables.provenance.md)) | Native's receipts and the same layers (heights that hug text left out) |
| Restated rules | Spreadsheet cells (tabs, quoted cells, the 50 × 20 limit) and the resize rule | Pass |
| Browser | A table's tinted header, a column line and a white cell | Pass, by pixels; failed before |

## Recorded differences

- **Text heights.** Native's headless engine measures no text; the rows, cells and table hug the port's measured text, so their heights are left out of the comparison.
- **Editing in place and pasting.** A double-click typing in a cell, and pasting a spreadsheet as a table, come with the board interface (item 10). The spreadsheet reader they use is here.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/boards/board_table.rs` (`make_table`, `make_row`, `make_cell`, `restyle`, `answer`, `table_cmd`, `edit_cmd`, `table_of`, `settle_resize`, `spreadsheet_cells`) | `board-table.ts`, `board-commands.ts`, `editor.ts` |

[Property matrix](26-11-25-board-tables-parity.html) · [Plan](../planning/26-11-25-board-tables.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-tables.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `6b0e410`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,712 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 446 cumulative Chromium cases passed in one 16.9-minute run at `6b0e410` with zero skips, retries, flakes or suite errors: the 445 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 12.97 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,770 nodes/41,411 edges at `6b0e410`; native 28,939/92,127 at `bad07e44`; combined 38,709/132,279. `makeTable`, `editTable`, `spreadsheetCells`, `settleTables` and `tableAnswer` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-tables.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "board table draws" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 7 to 10.
