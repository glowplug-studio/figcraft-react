# Delta row 1, item 3: a whole ellipse is four closed cubics

## Execution checkpoint

- Phase: complete through Phase 7 on 19 November 2026 at `de054fa`: [report](../reports/26-11-19-four-anchor-ellipse.md), [matrix](../reports/26-11-19-four-anchor-ellipse-parity.html), [provenance](../../tests/fixtures/native-ellipse-four-anchor.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `d704252` on `prompt/full-figcraft-port`.
- Upstream commits: `b33da8a7` (four anchors) and `4118be89` (the contour is closed), both #2080, plus the render band-test follow-ups `0774e44f` and `0c1fb11c`.
- Files in progress: none.
- Native oracle: a disposable Cargo project outside the repository (`$HOME/.cache/figcraft-oracle/project`) built in the `rust:latest` Docker image with the submodule mounted read-only. Two binaries: `replay` (command sequences through `Session::execute`) and `hits` (text-on-a-path tool clicks through `Session::pointer`). Their sources go into a provenance file beside the fixtures when the fixtures change.
- Next action: none for this item. The oracle project and its Cargo caches remain under `$HOME/.cache/figcraft-oracle` for the next items; later builds can run with `--offline`.
- Blockers: none. The oracle build is CPU-heavy and must not overlap a browser gate.

## Native contract

`crates/geom/src/lib.rs::ellipse(width, height, start, sweep, inner)`:

- A whole turn with no inner radius returns `whole(rx, ry)`: move to the right extreme, then four cubics through the bottom, left and top extremes back to the right extreme (clockwise from 3 o'clock, y down), with handle length `0.5522847498307934` of the radius along each tangent, then close.
- A whole ring is the outer `whole` followed by the reversed inner `whole`. `reverse_subpaths` starts at the last point, reverses each cubic and keeps the close.
- A whole turn ignores `start` and the sign of `sweep`, as before.
- A sliced ellipse, pie or arc still builds a tolerance-subdivided arc and closes.

Before `b33da8a7` a whole ellipse was a tolerance-subdivided arc starting on its major axis, five or six cubics at ordinary sizes, and was left open.

Native tests: `a_whole_ellipse_is_four_cubics_through_the_extremes`, `a_whole_ring_is_four_cubics_per_contour`, `a_sliced_ellipse_still_builds_its_arc`, and the full-disc area allowance widened from 2 to 5 in the existing area test.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `geom::ellipse` whole and ring branches | `src/engine/ellipse.ts::ellipsePath` | The three native tests restated in `tests/parity/ellipse.test.ts`; both new cases failed before the change |
| `geom::ReverseSubpaths` for a closed contour | `ellipse.ts::reverseCubics` plus the close | Ring case: contour letters, inner start and first reversed end point |
| `svg` path writer for an ellipse | `src/engine/export-svg.ts` | `native-svg-export.json` re-observed |
| `vectordrawable` path writer | Android XML export | `native-vector-drawable.json` re-observed |
| `text.onPath` with an ellipse source; `TextPath.d` | `src/engine/text-path-commands.ts` | `native-text-path-commands.json` case 22 re-observed |
| `canvas/tools/click.rs::path_at` through the text-on-a-path tool | `text-path-commands.ts::textPathAt` | `native-text-path-hits.json` ellipse row re-observed |

## First disagreement list

Applying the change and running the pure suite gave 21 failures in five files:

- `tests/parity/ellipse.test.ts`, three older cases that encoded the previous native behaviour (major-axis start, open contour, 4,097 elements at astronomical sizes, area allowance 2). They are rewritten to the upstream behaviour and cite the commit.
- `tests/parity/svg-export.test.ts`: `ellipse`, `eroded group`, `radial handles`, `spread group`. The one inspected difference is a trailing `Z` on the ellipse path.
- `tests/parity/vector-drawable.test.ts`: twelve cases that contain an ellipse.
- `tests/parity/text-path-commands.test.ts` case 22: the text path's `d` has four cubics and a close instead of five cubics.
- `tests/parity/text-path-tool.test.ts`: the 432 recorded pointer decisions; the ellipse row's start fractions depend on the path's length parametrisation.

## Hazards

- A recorded fixture is native output at an earlier pin. Its expectation changes only on a native observation at `bad07e44`, never because the port's new output looks plausible.
- The oracle must reproduce the unaffected recorded cases byte for byte before its changed cases are trusted; a difference there means the harness differs from the original generator, not that native changed.
- Text cases need the native bundled fonts in a headless container. If they do not reproduce, record that and derive case 22 from the geometry alone, labelled as source-derived.
- Rendering changes with the geometry. Pixel fixtures and screenshots that include whole ellipses may move by antialiasing amounts; the cumulative browser gate decides. A screenshot baseline changes only after its differing pixels are inspected and attributed to the ellipse outline.
- Closing the contour adds a zero-length closing segment for stroke joins and dashes: check dashed and variable-width ellipse strokes in the stroke parity tests and the browser stroke cases.
- `ellipse-performance.spec.ts` carries a frame budget; fewer segments should not regress it.

## Acceptance

- The three native ellipse cases and the updated older cases pass.
- Every changed recorded fixture has provenance naming `bad07e44`, the oracle sources and the unaffected-case reproduction count.
- Full pure suite, strict types, both builds, focused ellipse, stroke, mask, export and text-path browser cases, then the cumulative browser gate, provider integrations and zero fixture counts.
- Records: report, property matrix, cross-repository mapping, row 1 plan and delta queue.
