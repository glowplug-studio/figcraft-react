# Upstream delta row 2, item 9: the smart guide distance

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `a204eae`. **This bounded item passes. Ten items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `a1980463` measured the target application and set the object snap distance to 4.5 screen pixels; it was 5. The port now has [`OBJECT_SNAP_PX`](../../src/engine/snapping.ts) and uses it where it wrote `5 / zoom`:

- a move, with its equal-spacing snap ([move-interaction.ts](../../src/engine/move-interaction.ts));
- a resize ([transform-interaction.ts](../../src/engine/transform-interaction.ts));
- a drawn shape ([draw-interaction.ts](../../src/engine/draw-interaction.ts));
- dragged vector points and the pen ([vector-point-snap.ts](../../src/engine/vector-point-snap.ts)).

The rotation origin keeps 5, as in native, where it is not measured. The port has no ruler-guide snapping.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-snap-distance.json](../../tests/fixtures/native-snap-distance.json) | Fifty-two sessions: a move, a resize, a draw and a vector point drag ending 4.4, 4.5, 4.6, 4.9 and 5.1 screen pixels from a neighbour's edge at 100% and 200% zoom with the pixel grid off, and 4, 5 and 6 pixels with it on | All 52 match. Twenty failed before the change: every drag at 4.6 and 4.9, and at 5 with the pixel grid on, snapped in the port and does not in native |

[Provenance and reproduction](../../tests/fixtures/native-snap-distance.provenance.md).

The distance is inclusive: a gap of exactly 4.5 snaps.

## The replay harness

The port's [replay harness](../../tests/support/native-session.ts) now offers a recorded drag to the port's interactions in the order the canvas does: vector points, shape handles, transform handles, the draw tool, then move and marquee. Before, it drove move and marquee only. The earlier session fixtures (locked layers, marquee, Count handle and the rest) still pass.

## One earlier expectation changed

`snap-priority.test.ts` checks that the pointer is rounded to the pixel grid before the capture radius is tested. Its numbers were chosen for 5 pixels: a point 4.95 from an edge. They move to a point 4.45 from the edge, whose rounded position is 4.75 away. The rule is unchanged.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/canvas/tools/handles.rs::SNAP_PX` | `snapping.ts::OBJECT_SNAP_PX` |
| `canvas/tools/drag.rs` move and resize | `move-interaction.ts`, `transform-interaction.ts` |
| `canvas/tools/draw.rs` | `draw-interaction.ts` |
| `canvas/vectoredit/point_snap.rs` | `vector-point-snap.ts::VectorPointTargets.snap` |
| `handles.rs::UNMEASURED_SNAP_PX` in `canvas/rotation_origin.rs` | `rotation.ts` (5, unchanged) |

[Property matrix](26-11-21-snap-distance-parity.html) · [Plan](../planning/26-11-21-snap-distance.md) · [Snap parity](../../tests/parity/snap-distance.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `a204eae`, native reference `bad07e44` |
| Failing fixtures first | 20 of the 52 sessions failed before the change |
| Older expectations | One, described above, adapted to the new distance |
| Full pure suite | 5,322 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 396 cumulative Chromium cases passed in one 16.7-minute run with zero skips, retries, flakes or suite errors: the 395 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 14.72 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,701 nodes/37,272 edges at `a204eae`; native 28,939/92,127 at `bad07e44`; combined 37,640/128,229. `OBJECT_SNAP_PX`, `SNAP_PX`, `snapMove`, `snap_move`, `snapPoint`, `snap_point` and `VectorPointTargets` verified. |

## Verification corrections retained

The first recording left the pixel grid on and used fractional gaps. The pointer is rounded before the snap, so 104.4 became 104 and 104.6 became 105, and the sessions could not show whether the distance was 4.5 or 5. They were replaced by sessions with the pixel grid off, and by whole-pixel gaps with it on.

## Reproduction

```sh
npx vitest run tests/parity/snap-distance.test.ts tests/parity/snap-priority.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The equal-spacing snap shares the distance in the port as in native; its own boundary was not observed.
- The pen's snap goes through the same function as dragged vector points and was not observed separately.
- The browser case covers a move at 100% with the pixel grid on.
- Row 2 continues with item 10, Shift while rotating.
