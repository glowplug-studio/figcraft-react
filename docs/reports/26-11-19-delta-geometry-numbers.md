# Upstream delta row 1, items 1 and 2: SVG number sizing and display rounding

19 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementations `55ad7e6` (SVG compact arc flags) and `c56be59` (display rounding). **Both bounded items pass. Five items of row 1, the other delta rows and the full port remain unfinished.**

## Item 1: compact SVG arc flags (upstream `832e790c`, #2299)

Native `svg_path` refuses path data holding a number past 1e9 before parsing it. Since `832e790c` its scanner, `number_past`, knows that the fourth and fifth numbers of an arc are single-character flags that may run into the next number. The React size check matched every number with one pattern, read `11999999999` as a single value and refused valid compact arcs. The parser itself already read compact flags correctly.

[svg-path.ts](../../src/engine/svg-path.ts) now carries a direct port of `number_past` in place of the pattern loop:

- numbers split as the SVG grammar does (`1-2` and `.5.5` are two each, `1e-3` is one);
- a flag is consumed only at the fourth or fifth position of each seven arc numbers and only while no number is in progress;
- any ASCII letter starts a command and resets the count; only `A` and `a` are arcs;
- a partial token such as `-`, `.` or `1e` is ignored, as Rust's float parser rejects it (JavaScript would read an empty token as zero);
- the limit itself is allowed; overflow and anything above it refuse the path.

The React error text and the later finite checks are unchanged.

The practical effect is wider than astronomically large arcs: a small arc whose endpoint is written with leading zeros, such as `A10 10 0 11000000020 10`, was dropped silently on SVG import because the importer discards a path that fails to parse.

## Item 2: display rounding (upstream `c47de279`, #2309)

Native `round_to` rounds a value for display, never returns negative zero and, since `c47de279`, returns a huge finite value unchanged when scaling it would overflow. Its callers are node inspection (`automation/inspect.rs::round`, two decimals) and the node description's rotation (`cmd/props.rs::describe`, three decimals).

[affine.ts](../../src/engine/affine.ts) gains `roundTo`, a direct port, and [inspect.ts](../../src/engine/inspect.ts) uses it for `node.get`. Before the change the inspection rounder:

- returned infinity for a huge finite value, which serialises as `null`. Such a value is reachable: `shape.rectangle` and `node.set` accept an `x` or width of 1e307;
- returned negative zero for a tiny negative value, for example an `x` of −0.001.

Only the inspection caller exists in the port. No React counterpart of the native `describe` receipt with a three-decimal rotation was found; that consumer belongs to the automation rows and is recorded as not ported, not as verified.

## Native mapping and independent evidence

| Native | React | Evidence |
|---|---|---|
| `crates/geom/src/lib.rs::{svg_path,number_past,MAX_SVG_COORD}` | `svg-path.ts::{parseSvgPath,numberPast,maxSvgCoordinate}` | `crates/geom/tests/svg_arc_flags.rs`, both cases, plus boundary fixtures |
| `crates/geom/src/transform.rs::round_to` | `affine.ts::roundTo` | `crates/geom/src/tests.rs::{round_to_handles_large_precision_without_changing_finite_values,round_to_keeps_huge_finite_values_finite}` |
| `crates/engine/src/automation/inspect.rs::round` | `inspect.ts::round` | `node.get` fixture in Node and through the browser command bridge |

The fixtures restate native test inputs and outcomes. No Rust was executed; expectations beyond the native tests follow from the pinned source and are marked Medium in the matrix.

[Property matrix](26-11-19-delta-geometry-numbers-parity.html) · [Plan](../planning/26-11-19-svg-arc-flags.md) · [SVG path parity](../../tests/parity/svg-path.test.ts) · [Rounding parity](../../tests/parity/round-to.test.ts) · [Chromium workflows](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Item 1 at `55ad7e6` | Item 2 at `c56be59` |
|---|---|---|
| Failing fixture first | One parity case failed with the React size error | All four original rounding cases failed: no `roundTo`, and `node.get` returned negative zero. The huge-position case was added after the port, once a probe showed commands accept such values; it was not observed failing |
| Focused checks | 10 SVG path cases | 12 cases across rounding and affine parity, including `node.get` on a rectangle at 1e307 |
| Full pure suite | 4,797 passed | 4,802 passed in 25.30 seconds, four workers |
| Strict types / production builds | Passed | Passed |
| Focused browser | SVG open/drop/paste with a compact-arc path, SVG download, REST, Fig text path and Penpot workflows: 5 passed | `node.get` through the public command bridge: passed in 3.3 seconds |
| Cumulative Chromium | All 382 cases passed in one 1,006.265-second run, zero skips, retries, flakes or suite errors | All 383 cumulative Chromium cases passed in one 987.433-second run with zero skips, retries, flakes or suite errors. See the correction below |
| Real local provider integrations | 32 passed in 14.96 seconds | 32 passed in 14.90 seconds |
| Fixture cleanup | All twelve counts zero | All twelve counts zero |
| Schema / hosted | No change; no hosted call | No change; no hosted call |
| Local graph | — | React 8,493 nodes/36,363 edges at `c56be59`; native 28,939/92,127 at `bad07e44`; combined 37,432/127,350. `roundTo`, `round_to`, `numberPast` and `number_past` verified. |

## Verification corrections retained

During item 2's cumulative run the coordinator stashed `src/engine/affine.ts` and `src/engine/inspect.ts` by mistake and restored them about ten seconds later. The preview under test was already built from the final source, but rendering specs bundle their fixtures from source at run time, so the cases in progress could have bundled the earlier, self-consistent versions of those two files. By the time the files were restored 19 cases had completed. All 24 cases of the eleven spec files that had started by then (`blend-rendering` through `group-performance`) were rerun on the restored source and passed in 51.6 seconds. The 383-case result therefore stands as one invocation with that qualification, plus the 24-case rerun. No product or test expectation changed.

A first draft of this report said a huge coordinate could not be created through commands. A probe showed `shape.rectangle` and `node.set` accept 1e307, so a public `node.get` fixture was added for it.

## Reproduction

```sh
npx vitest run tests/parity/svg-path.test.ts tests/parity/round-to.test.ts tests/parity/affine.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run, with `pdftoppm` on `PATH`:

```sh
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts --grep "open, drop and paste SVG|node.get reports a tiny negative offset" --workers=1 --retries=0
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0
```

## Remaining gaps

- The native `describe` rotation at three decimals has no ported consumer.
- Row 1 continues with item 3, four-anchor ellipses. That change alters whole-ellipse geometry and therefore rendering, strokes and every export that writes an ellipse path; its plan must decide which recorded native fixtures need regenerating at `bad07e44`.
