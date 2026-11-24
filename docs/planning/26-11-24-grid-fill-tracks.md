# Delta row 4, item 1: grid Fill tracks

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `addee52`: [report](../reports/26-11-24-grid-fill-tracks.md), [matrix](../reports/26-11-24-grid-fill-tracks-parity.html), [provenance](../../tests/fixtures/native-grid-fill-tracks.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `38285c0` on `prompt/full-figcraft-port`.
- Upstream commits: `a28c03d9`, `92753a8f` (docs), `daa6b5b2` (docs). Ledger item 4.1.
- Files changed: `src/engine/grid-layout.ts`; tests `tests/parity/grid-fill-tracks.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-grid-fill-tracks.json` with provenance; re-pinned rows of `tests/fixtures/native-layout-rules.json` and `native-flow-layout.json`.
- Next action: none; the item is recorded. Row 4 continues in its row plan.
- Blockers: none.

## Native contract

- **`layout/src/lib.rs::grid_geometry`** (`a28c03d9`, measured in Figma): on a fixed-size axis a Fill (fr) track splits the free space by its fraction after gaps and padding, and a fixed-size or hug-size child alone in it asks nothing of the track, so a child bigger than its share overflows into the next track. A Fill child's own minimum, spanning children, Hug and Fixed tracks and the Hug-axis path are unchanged.

## What the port had

`gridGeometry` let every child ask its size of its tracks, so a fixed child taller than its share grew its row (the earlier rule from the documentation, "a track never gets less than its content").

## Source mapping

| Native | React | Verification |
|---|---|---|
| `layout/src/lib.rs::grid_geometry` (children's track demands) | `grid-layout.ts::gridGeometry` (`inFill`) | Eight native grids; browser |
| `layout/src/lib.rs::resolve_tracks` | `grid-layout.ts::resolveAxis` (unchanged) | The same grids |

## Acceptance

- Each native observation matches; five of the eight new cases fail without the change, the three controls passing; the re-pinned rows of the two older fixtures match.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
