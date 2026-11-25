# Native observations for board tables

Data: [native-board-tables.json](native-board-tables.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`commands` and `results` are native's answer to each command on a new board:

- a default 3 × 3 table, and a table made from given cells (a short last row is filled in);
- on the first table, `board.tableEdit` adds a row at index 1 and a column at index 0, then removes the last row and the column at index 1;
- the refusals: an unknown action, an index past the end, zero or 51 rows, and cells that don't fit.

`document` is the `document.json` of the save that ends the run. Native's headless engine measures no text, so the heights that hug text are not compared.
