# Upstream delta row 1, item 4: Pencil and Simplify keep to their input

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `11b1a55`. **This bounded item passes with one recorded difference in a neighbouring component. Three items of row 1, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #1741 (`0aba3f76`, `61389cdd`) stopped a Pencil stroke or a simplified path from shooting far off its input. Native now wraps Kurbo's simplification in `simplify_path`:

- the path is cut where it turns straight back, so a turn stays a point of the stroke;
- each fitted run is measured against the run it replaces, and one that strays more than twice the accuracy asked for is kept as it was;
- subpaths and closes are kept.

[simplify-guard.ts](../../src/engine/simplify-guard.ts) is a direct port. [`simplifyPath`](../../src/engine/simplify-path.ts) is now the guarded simplification, used by `vector.simplify`, and `simplifyPencil` draws the Pencil's samples through the same function, as native does.

## What had to change underneath

The guard only matches native if the fit it guards behaves as Kurbo's does, including where Kurbo's fit is bad. Comparing the port with raw Kurbo output from a native oracle showed it did not, on exactly the inputs this upstream change is about:

1. **Lines.** Kurbo raises a line to a cubic whose control points sit on its ends. The fit then sees no direction at a join between lines and moves along a line as a smooth step. The port gave lines a constant direction and rate. The generic simplifier now raises lines as Kurbo does, and the separate constant-rate polyline source is removed.
2. **Arithmetic order.** On straight runs the fit's coefficients are rounding noise, and the last bit decides which candidate wins. [fit-cubic-source.ts](../../src/engine/fit-cubic-source.ts) now evaluates, subdivides and integrates moments in Kurbo's closed form and order; [fit-polynomial.ts](../../src/engine/fit-polynomial.ts) scales by reciprocals as Kurbo's solvers do; [pencil-fit.ts](../../src/engine/pencil-fit.ts) takes sampling steps, moments and the candidate transform in Kurbo's order.

Both predate this item. Their effect was that the port drew a nearly straight Pencil run as one tidy curve where native, before #1741, drew an erratic one and, after it, keeps the samples as lines.

## Observable effects

- A Pencil stroke that goes out and comes back keeps its turn as a point; a nearly straight run of samples stays where it was drawn.
- `vector.simplify` on straight runs returns what native returns: a straight three-line stroke becomes 13 collinear pieces at tolerance 0 and 7 at the default, and a rectangle with points along one side goes from 9 segments to 17. Earlier port tests expected such runs to collapse to one segment; native never did that.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-simplify-path.json](../../tests/fixtures/native-simplify-path.json) | 36 inputs, 90 results; each with native `simplify_path` and raw Kurbo output at full precision | Guarded output: all 90 match, 84 exactly and 6 within 1.1e-9. Raw Kurbo: all 84 non-panicking results match in structure, 71 exactly and 79 within 5e-9 |
| [native-vector-simplify.json](../../tests/fixtures/native-vector-simplify.json) | Three `vector.simplify` sequences with every receipt and the exported SVG | Counts, bounds and anchor positions match; segment kind and start vertex differ, see below |
| [native-pencil-strokes.json](../../tests/fixtures/native-pencil-strokes.json) | Four strokes drawn with the native Pencil tool | Layer receipts and exported SVG match byte for byte |

[Provenance, sources and reproduction](../../tests/fixtures/native-simplify-path.provenance.md).

## Recorded differences

- **After Simplify, straight pieces are cubics in the port and lines in native.** Native's path normaliser, the `linesweeper` crate, writes straight segments as lines and starts each contour at another vertex. The port's normaliser keeps straight cubics. Vertex and segment counts, bounds and anchor positions match native. This belongs to boolean normalisation, predates this item and is queued for the final audit.
- **Failed fits match in shape, not always in coordinates.** On `nearly collinear` Kurbo's stray control point is several hundred units out and the port's differs from it by about half a unit. The guarded result is identical because the run is discarded either way.
- **Quadratic segments** are not part of the port's path model; the upstream cases that use them are restated with lines and cubics.

## Native mapping

| Native | React |
|---|---|
| `crates/geom/src/simplify.rs::{simplify_path,flush,keeps_to,tangents}` | `simplify-guard.ts::{simplifyKeeping,keepsTo,tangents}` |
| Kurbo `simplify_bezpath`, `PathSeg::to_cubic` | `simplify-path.ts::simplifyBezPath` |
| Kurbo `SimplifyBezPath`, `moment_integrals`, `CubicBez::{eval,deriv,subsegment}` | `fit-cubic-source.ts` |
| Kurbo `solve_quadratic`, `solve_cubic`, `fit_to_cubic` | `fit-polynomial.ts`, `pencil-fit.ts` |
| `canvas/tools/pen.rs::pencil_finish` | `simplify-path.ts::simplifyPencil` |
| `cmd/structure.rs` `vector.simplify` | `vector-simplify.ts` |

[Property matrix](26-11-20-pencil-simplify-keeps-to-input-parity.html) · [Plan](../planning/26-11-20-pencil-simplify-keeps-to-input.md) · [Guard parity](../../tests/parity/simplify-guard.test.ts) · [Pencil strokes](../../tests/parity/pencil-interaction.test.ts) · [Simplify](../../tests/parity/vector-simplify.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `11b1a55`, native reference `bad07e44` |
| Observed before the change | With the guard alone, the port disagreed with native in 13 of the first 81 results, because its fit differed from Kurbo's; with the fit corrected none disagree |
| Older expectations | Ten earlier Pencil and Simplify cases and two browser cases disagreed. Each scenario was observed natively and now states that result. Property tests of the removed constant-rate line source were deleted |
| Full pure suite | 4,983 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 383 cumulative Chromium cases passed in one 937.650-second run with zero skips, retries, flakes or suite errors. No baseline changed, including the pixel-exact Simplify screenshot |
| Real local provider integrations | 32 passed in 13.36 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,510 nodes/36,415 edges at `11b1a55`; native 28,939/92,127 at `bad07e44`; combined 37,449/127,400. `simplifyKeeping`, `simplify_path`, `keepsTo` and `keeps_to` verified. |

## Verification corrections retained

The first cumulative attempt passed 245, failed two and did not run 136. Both failures asserted that Simplify reduces the number of segments on shapes with collinear points along a side: a browser workflow and a benchmark. Each shape was replayed through the native engine, which goes from 9 segments to 21 and to 17. The two cases now assert those counts and cite the fixture; the pixel-exact screenshot in the workflow did not change. `preview.spec.ts` is serial, so the 136 cases after the first failure were skipped. The whole suite then passed in one run on the same build.

Twelve expectations changed in all. None was changed without a native observation of the same scenario, and each records where its number comes from.

## Reproduction

```sh
npx vitest run tests/parity/simplify-guard.test.ts tests/parity/pencil-fit.test.ts tests/parity/pencil-interaction.test.ts tests/parity/vector-simplify.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The normaliser difference above.
- No browser case draws the upstream sample strokes with a pointer; the engine-level Pencil cases cover the same code path the canvas calls.
- Row 1 continues with item 5, rounding the sharp corners of a closed path (#2222).
