# Delta row 1, item 4: Pencil and Simplify keep to their input

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `11b1a55`: [report](../reports/26-11-20-pencil-simplify-keeps-to-input.md), [matrix](../reports/26-11-20-pencil-simplify-keeps-to-input-parity.html), [provenance](../../tests/fixtures/native-simplify-path.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `2182187` on `prompt/full-figcraft-port`.
- Upstream commits: `0aba3f76` and `61389cdd` (#1741).
- Files landed: `src/engine/simplify-guard.ts` (new), `simplify-path.ts`, `fit-cubic-source.ts`, `fit-polynomial.ts`, `pencil-fit.ts`, `fit-polyline.ts`, `pencil-path.ts`; `tests/parity/simplify-guard.test.ts` (new), `pencil-fit.test.ts`, `pencil-interaction.test.ts`, `vector-simplify.test.ts`; three new fixtures and their provenance under `tests/fixtures/`.
- Next action: none for this item.
- Blockers: none.

## Native contract

`crates/geom/src/simplify.rs::simplify_path(path, accuracy)` wraps Kurbo's `simplify_bezpath`:

1. The path is cut where it turns back by more than a right angle (the dot product of the last end tangent and the next start tangent is negative). Each run between cuts is simplified on its own and the runs are joined, so a turn stays a point of the path. A segment of no length is dropped.
2. Each fitted run is measured against the run it replaces: every fitted segment must end on the source, and fifteen points along it must lie within twice the accuracy of the source segments it spans. A run that strays is kept as it was.
3. Subpaths and closes are kept. A segment drawn on from a close starts a subpath at the closed one's start. A move with nothing drawn leaves no trace.

Callers: the Pencil (`canvas/tools/pen.rs::pencil_finish`, accuracy 0.75 over the line samples) and four call sites in `cmd/structure.rs` for `vector.simplify`.

## What the port had, and what observation showed

The port already carried an independent version of Kurbo's simplification in two forms: `simplifyPath` for lines and cubics and `simplifyPencil` over a linear polyline source. Neither had the guard.

A native oracle produced both `simplify_path` and raw `simplify_bezpath` output for the inputs of the upstream tests. Comparing the port with the raw Kurbo output, before adding the guard, showed the port's fit did not reproduce Kurbo on exactly these inputs, for two reasons that predate this item:

- **Lines.** Kurbo raises a line to the cubic `(p0, p0, p1, p1)`. The fit then sees a zero tangent at each join between lines and moves along a line as a smooth step. The port used a constant tangent and a constant rate, a better model that fits nearly straight runs well where Kurbo fits them badly. Native behaviour depends on the bad fit: it is what the guard detects and discards.
- **Arithmetic order.** On straight or nearly straight runs the fit's coefficients are rounding noise around zero, and which candidate wins depends on the last bit. The port divided where Kurbo multiplies by a reciprocal, integrated moments by quadrature where Kurbo uses a closed form, and placed candidates with the chord vector where Kurbo composes translate, rotate and scale.

Both are corrected in this item because the guard cannot match native without them.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `geom::simplify::{simplify_path,flush,keeps_to,tangents}` | `simplify-guard.ts::{simplifyKeeping,keepsTo,tangents}` | 90 native results in `native-simplify-path.json` |
| Kurbo `simplify_bezpath`, `PathSeg::to_cubic` for lines | `simplify-path.ts::simplifyBezPath` | The same fixture's raw Kurbo results |
| Kurbo `SimplifyBezPath` sampling and `moment_integrals`, `CubicBez::{eval,deriv,subsegment}` | `fit-cubic-source.ts` | As above |
| Kurbo `solve_quadratic`, `solve_cubic`; `fit_to_cubic` preamble and affine placement | `fit-polynomial.ts`, `pencil-fit.ts::fitRange` | As above |
| `pencil_finish` | `simplify-path.ts::simplifyPencil` via `pencil-path.ts` | `native-pencil-strokes.json`: layer and exported SVG for four strokes |
| `vector.simplify` call sites | `vector-simplify.ts` (unchanged; calls `simplifyPath`) | `native-vector-simplify.json`: counts, bounds and anchor positions |

## Removed

`FittingPolyline` and `fitPencilRun` modelled the constant-rate line source. Nothing in the product uses them after this change and they do not describe native behaviour, so they and their property tests are removed. The native-observed fixtures replace that coverage.

## Hazards and known differences

- The port reproduces the shape of Kurbo's failed fits (the same number and kind of segments) but not always their exact coordinates: on `nearly collinear` the stray control point differs by about half a unit out of several hundred. The guarded result is identical because the run is discarded either way. `a cubic out and back` at accuracy 0.1 agrees with raw Kurbo to four decimals, and to machine precision once guarded.
- Results on curved input agree with native to about 1e-9, not bit for bit: arc-length measurement and the platform's trigonometric functions differ in the last places.
- After `vector.simplify`, native's path normaliser (the `linesweeper` crate) writes straight pieces as lines and starts each contour at another vertex. The port's normaliser keeps straight cubics. Vertex and segment counts, bounds and anchor positions match native; the segment kind and start vertex do not. This predates the item and is recorded for the final audit.
- Quadratic segments are not part of the port's path model; the upstream cases that use them are restated with lines and cubics only.

## Acceptance

- All native results in the three fixtures match.
- The older Pencil and Simplify cases state native-observed results.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, row 1 plan and delta queue.
