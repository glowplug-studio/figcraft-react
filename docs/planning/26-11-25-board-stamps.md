# Roadmap row 16, item 5: stamps and ink

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `1f3d73e` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-commands.ts` (`board.stamp` with the six stamps' colours and marks, `board.ink`, `stampTarget`, `settleBoardStamps`); `src/engine/editor.ts` (stamps settled after each edit); tests `tests/parity/board-stamps.test.ts`, fixture `tests/fixtures/native-board-stamps.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`doc/src/board.rs` `Stamp`; `engine/src/boards/board/{items,derived}.rs`)

- **board.stamp** `{x, y, stamp?}`: a 40-point round badge named after the stamp. It is centred on the point in the stamp's colour with a soft shadow, and holds the mark as white vector parts: filled, or stroked 3 with round caps and joins. It records its author and the object it lands on: the top-most layer of the page under its centre other than stamps, connectors, labels and ink.
- **board.ink** `{path | points, highlighter?, color?, select?}`: a vector named Ink (or Highlight) stroked round in the marker's colour, weight 4. A highlighter is weight 20 at 0.45 opacity, multiplied.
- **Settling**: a stamp moves with the object it sits on. One moved by itself sits on what is under its centre now, and one whose object is gone sits on nothing and stays.
- **Refusals**: an unknown stamp; ink with neither path nor points.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/board.rs::Stamp::{id, label, color, mark}`, `STAMP_SIZE`; `engine/src/boards/board/items.rs::{stamp_cmd, ink_cmd}`, `board.rs::{MARKER, HIGHLIGHTER}` | `board-commands.ts` | Native observation |
| `engine/src/boards/board/derived.rs::{settle_stamps, stamp_target, carry}` | `board-commands.ts` `settleBoardStamps`; `editor.ts` | Native observation; parity test; browser case |

## Acceptance

- Native's run (six stamps on a sticky, one on nothing, marker and highlighter strokes, the refusals, the sticky moved with its stamps) is replayed with native's receipts and layers.
- A stamp moved onto another object sits on it, and on nothing once that object is deleted.
- A browser case draws a stamp and ink and moves the sticky with its stamp. It failed before (no stamps or ink).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
