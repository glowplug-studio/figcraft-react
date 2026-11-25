# Roadmap row 16, item 4: reshaped connectors and joined shapes

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `1f3d73e`: [report](../reports/26-11-25-board-reshape.md), [matrix](../reports/26-11-25-board-reshape-parity.html), [provenance](../../tests/fixtures/native-board-reshape.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `9b457e5` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-commands.ts` (`board.reshape`, `board.addConnected`, `board.nextSticky` from a shape, `connectedPlace`); tests `tests/parity/board-reshape.test.ts`, fixture `tests/fixtures/native-board-reshape.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded. Item 5 follows in the row plan.
- Blockers: none.

## Native contract (`engine/src/boards/board/{reshape,items}.rs`)

- **board.reshape** `{id?, portion, x, y}`:
  - Elbow: the elbow's run `portion` moves to the point, and a first or last run gains an extra run to stay on its end. A lone run gains one at each end.
  - Curved: the curve's middle moves there and keeps its bow as the ends move.
  - The path is measured from the middle of the ends, so it travels with what the connector joins. The ends' sides are pinned to the ones they left by.
  - Refused: a straight connector, a portion it doesn't have, a fractional or negative one, or a path of more than 64 runs.
  - A new style or a reattached end goes back to routing itself.
- **board.addConnected** `{id?, side?, at?, edit?}`: the next sticky or shape of the same kind, size and colour, 80 away on the side (right by default), joined by a connector with the board tools' routing. Dropped at a point instead, the next one is centred there and the connector arrives by the side facing it.
- **board.nextSticky** from a shape is `board.addConnected`.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/boards/board/reshape.rs::{pinned, moved, place, reshape}`, `doc/src/board_route.rs::{reshaped, reshaped_runs, attached_sides}` | `board-commands.ts`; `board-route.ts` | Native observation; restated native tests |
| `engine/src/boards/board/items.rs::{CONNECTED_GAP, connected_place, add_connected, drop_point}`, `next_sticky` (a shape) | `board-commands.ts` | Native observation |

## Acceptance

- Native's run (reshaping elbow and curved connectors and its refusals, joined shapes and stickies on every side and at a dropped point, `nextSticky` from a shape, a restyle dropping the path) is replayed with native's receipts and layers.
- Native's reshape tests are restated: moving a run, keeping sides, extra runs, a lone run, a curve's bow, the refusals, the limit, and a new style or end.
- A browser case draws a reshaped connector and a joined shape. It failed before (no reshaping or joined shapes).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
