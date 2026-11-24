# Upstream delta row 4, item 1: grid Fill tracks

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `addee52`. **This bounded item passes. Three items of row 4, the other delta rows and the full port remain unfinished.**

## Implemented boundary

On a fixed-size axis a grid's Fill track now shares the free space by its fraction, and a fixed-size or hug-size child alone in it asks nothing of the track, so a child bigger than its share overflows into the next track ([`gridGeometry`](../../src/engine/grid-layout.ts)). A Fill child still asks its minimum; spanning children, Hug and Fixed tracks and hugging axes are unchanged.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-grid-fill-tracks.json](../../tests/fixtures/native-grid-fill-tracks.json) | Eight grids: the six measured cases of native `grid_rules` (rows 50 / 50 with an overflowing child, columns 100 / 200, 300 × 200 at y 100, 105 with a row gap, Hug at 150 and frame 170) and two controls (a Fill child's minimum, a Hug track) | All eight match in the frame and every child. Five failed before; the controls passed |

Provenance: [grid Fill tracks](../../tests/fixtures/native-grid-fill-tracks.provenance.md).

## Older fixtures re-pinned

Upstream changed three of its own `grid_rules` cases, so two older native copies were brought to `bad07e44` by native observation, as the provenance records: [native-layout-rules.json](../../tests/fixtures/native-layout-rules.json) takes the three changed cases and native's three new ones (68 rules), and the grid case of [native-flow-layout.json](../../tests/fixtures/native-flow-layout.json) takes its two grid children's new positions. Its case "vertical auto gap" stays as recorded: replayed with the packaged fonts it differs by a text width, which the font build explains.

## Native mapping

| Native | React |
|---|---|
| `crates/layout/src/lib.rs::grid_geometry` | `grid-layout.ts::gridGeometry` |
| `crates/layout/src/lib.rs::resolve_tracks` | `grid-layout.ts::resolveAxis` (unchanged) |

[Property matrix](26-11-24-grid-fill-tracks-parity.html) · [Plan](../planning/26-11-24-grid-fill-tracks.md) · [Parity](../../tests/parity/grid-fill-tracks.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `addee52`, native reference `bad07e44` |
| Failing fixtures first | Five of eight new cases failed before; the controls passed |
| Full pure suite | 5,550 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 422 cumulative Chromium cases passed in one 17.0-minute run at `addee52` with zero skips, retries, flakes or suite errors: the 421 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 14.17 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,910 nodes/38,072 edges at `addee52`; native 28,939/92,127 at `bad07e44`; combined 37,849/129,009. `gridGeometry`, `resolveAxis`, `GridGeometry`, `grid_geometry` and `resolve_tracks` verified. |

## Reproduction

```sh
npx vitest run tests/parity/grid-fill-tracks.test.ts tests/parity/layout-rules.test.ts tests/parity/flow-layout.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "grid Fill tracks share" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 4 continues with item 2, layout snap bounds.
