# Upstream delta row 4, item 2: layout snap bounds

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `c053caa`. **This bounded item passes. Two items of row 4, the other delta rows and the full port remain unfinished.**

## Implemented boundary

The snap lines a frame's layout grids give together are bounded at 200,000, as native's `MAX_SNAP_LINES`: a grid whose lines, counted twice, would pass the budget is left out whole, with the grids after it ([`SnapTargets`](../../src/engine/snapping.ts)). A frame with a thousand 1 px grids gave eight million snap targets before.

## Native reference

| Case | Result |
|---|---|
| Unit: native `snap_lines_are_bounded_across_a_frames_grids` (a 4000 × 4000 frame with 1000 visible 1 px grids) | 192,000 lines, within 200,000 and more than 4000 each way, as native's arithmetic gives; failed before ([provenance](../../tests/fixtures/native-grid-snap-bounds.provenance.md)) |

## Recorded differences

- **No browser case.** The budget has no visible result of its own. A drag in the thousand-grid frame stalls first in the port's guide drawing, which draws every visible grid and is outside this item; it is in the handover's deferred queue.

## Native mapping

| Native | React |
|---|---|
| `crates/layout/src/lib.rs::{grid_snap_lines_in, MAX_SNAP_LINES}` | `snapping.ts::{SnapTargets, maxGridSnapLines}` |

[Property matrix](26-11-24-grid-snap-bounds-parity.html) · [Plan](../planning/26-11-24-grid-snap-bounds.md) · [Unit](../../tests/parity/grid-snap-bounds.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `c053caa`, native reference `bad07e44` |
| Failing fixtures first | The restated native test failed before (eight million lines) |
| Full pure suite | 5,551 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 422 cumulative Chromium cases passed in one 17.4-minute run at `c053caa` with zero skips, retries, flakes or suite errors, the same 422 cases as before. No baseline changed |
| Real local provider integrations | 32 passed in 14.20 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,912 nodes/38,087 edges at `c053caa`; native 28,939/92,127 at `bad07e44`; combined 37,851/129,023. `SnapTargets`, `maxGridSnapLines`, `guideRects`, `grid_snap_lines_in` and `grid_lines` verified. |

## Reproduction

```sh
npx vitest run tests/parity/grid-snap-bounds.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- The guide drawing for frames with many grids (deferred queue).
- Row 4 continues with item 3, Align unavailable in an auto layout flow.
