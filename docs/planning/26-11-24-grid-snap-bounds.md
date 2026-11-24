# Delta row 4, item 2: layout snap bounds

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `c053caa`: [report](../reports/26-11-24-grid-snap-bounds.md), [matrix](../reports/26-11-24-grid-snap-bounds-parity.html), [provenance](../../tests/fixtures/native-grid-snap-bounds.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `6de005c` on `prompt/full-figcraft-port`.
- Upstream commits: `1935c3ea`, `9d486259`. Ledger item 4.4.
- Files changed: `src/engine/snapping.ts` (`maxGridSnapLines`, the budget in `SnapTargets`); test `tests/parity/grid-snap-bounds.test.ts` (new); provenance `tests/fixtures/native-grid-snap-bounds.provenance.md`.
- Next action: none; the item is recorded. Row 4 continues in its row plan.
- Blockers: none.

## Native contract

- **`layout/src/lib.rs::grid_snap_lines_in`** with `MAX_SNAP_LINES` 200,000: a frame's visible grids add their snap lines in order; a grid whose lines, counted twice, would take the total past the budget is left out whole, and so are the grids after it.

## What the port had

`SnapTargets` added every visible grid's lines, so a frame with a thousand 1 px grids gave eight million snap targets.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `layout/src/lib.rs::{grid_snap_lines_in, MAX_SNAP_LINES}` | `snapping.ts::{SnapTargets, maxGridSnapLines}` | Restated native depth test |

## Recorded difference

- A browser case dragging inside the thousand-grid frame was tried and dropped: the port's canvas draws every visible grid's guides, which takes far longer than the snap targets at that count, before and after this change. Native's guide drawing is outside this item; the case is recorded in the deferred queue.

## Acceptance

- The restated native test passes and failed before; full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
