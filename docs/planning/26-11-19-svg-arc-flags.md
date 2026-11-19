# Upstream delta row 1: geometry and vectors, starting with SVG compact arc flags

## Execution checkpoint

- Phase: items 1–3 complete through Phase 7 on 19 November 2026 at `55ad7e6`, `c56be59` and `de054fa`. Reports: [items 1–2](../reports/26-11-19-delta-geometry-numbers.md), [item 3](../reports/26-11-19-four-anchor-ellipse.md). Item 4 is at Phase 1.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React revision: `de054fa` on `prompt/full-figcraft-port`.
- Source queue: row 1 of the [upstream delta queue](26-11-15-upstream-delta.md), range `7bf098d7..bad07e44`.
- Files in progress: none.
- Native oracle: `$HOME/.cache/figcraft-oracle/project` with warm Cargo caches; method and sources in [the ellipse provenance](../../tests/fixtures/native-ellipse-four-anchor.provenance.md). Its `replay` binary runs any command sequence through the native engine; `Session::pointer` is public for tool gestures.
- Next action: item 4, Pencil and Simplify staying on their input (#1741). Write a dated plan first. Evidence already read: upstream `0aba3f76` adds `crates/geom/src/simplify.rs::simplify_path` (about 140 lines) and replaces five direct calls to kurbo's `simplify_bezpath` with it: the Pencil fit in `canvas/tools/pen.rs` and four in `cmd/structure.rs` (`vector.simplify` and related). A fitted run that strays more than twice the asked accuracy from the run it replaces is kept as it was. `61389cdd` extends the tests to several accuracies. Native tests: `the_pencil_keeps_its_stroke_where_it_was_drawn` in `engine/src/brush_tests.rs`, `simplify_keeps_nearly_collinear_points_near_them` in `engine/src/vector_behaviour_tests.rs`, and the new cases in `geom/src/tests.rs`. Locate the React fit in the Pencil and Simplify modules, restate the native tests as failing fixtures, port `simplify_path`, and observe `vector.simplify` and Pencil gestures through the oracle where a recorded fixture disagrees.
- Blockers: none. Oracle builds are CPU-heavy; do not run them during a browser gate.

## Row 1 items in order

Each item is a separate bounded slice with its own failing fixture, verification and record. The upstream commits were read from `git log 7bf098d7..bad07e44 -- crates/geom crates/pathops`.

| Order | Upstream change | Native evidence under `original/figcraft/` | React owner to confirm | Status |
|---|---|---|---|---|
| 1 | Compact SVG arc flags are not part of the next number in the size check (`832e790c`, #2299) | `crates/geom/src/lib.rs::number_past`, `crates/geom/tests/svg_arc_flags.rs` | `src/engine/svg-path.ts::parseSvgPath` size scan | Verified at `55ad7e6` |
| 2 | `round_to` keeps huge finite values finite (`c47de279`, #2309) | `crates/geom/src/transform.rs::round_to`, `crates/geom/src/tests.rs::round_to_keeps_huge_finite_values_finite`; callers `engine/src/cmd/props.rs` (rotation) and `engine/src/automation/inspect.rs::round` | `src/engine/affine.ts::roundTo`, used by `src/engine/inspect.ts` for `node.get` | Verified at `c56be59`; the `describe` rotation has no ported consumer |
| 3 | An unsliced ellipse edits as four anchors, not six; the four-cubic contour is closed (`b33da8a7`, `4118be89`, #2080) | Ellipse tests in `crates/geom` and the engine ellipse edit path | `src/engine/ellipse.ts::ellipsePath` and its render, stroke and export consumers | Verified at `de054fa` with native observations |
| 4 | A Pencil stroke stays where it was drawn, without spikes (`0aba3f76`, `61389cdd`, #1741) | Simplification tests by deviation at several accuracies | `src/engine` Pencil fitting and simplify modules | Next; evidence read |
| 5 | Round the sharp corners of a closed path; each contour's size sets its weld tolerance (`c48d844d`, `4c91f908`, #2222) | `crates/pathops/src/round_tests.rs`, `crates/render/src/boolean_radius_tests.rs` | Boolean group corner radius rendering | Not started |
| 6 | Path operations budget the closed-faces input, share the dash allowance and index point incidence (`554ad0ea`, #2249) | `crates/pathops` | Path operation limits | Not started |
| 7 | Vector bridge, delete and flatten loops; sharp/smooth transitions | `crates/engine/src/vector_behaviour_tests.rs` | Vector edit commands | Not started |

## Item 1: observed native contract

`svg_path(d)` refuses path data holding a number past `MAX_SVG_COORD` (1e9) before parsing. `number_past` splits numbers as the SVG grammar does: `1-2` and `.5.5` are two numbers each and `1e-3` is one. Since `832e790c` it also tracks whether the current command is an arc and how many numbers it has had. The fourth and fifth of every seven are flags: a single `0` or `1` that may run into the next number unseparated. A flag is consumed only when no number is in progress. Any ASCII letter starts a new command and resets the count; only `A` and `a` are arcs. A token that does not parse as a number is ignored; one that parses to NaN, or whose magnitude exceeds the limit, refuses the path. The limit itself is allowed.

Native tests: `compact_arc_flags_are_not_part_of_the_next_number` (`M0 0A5 5 0 11999999999 0` equals the spaced form) and `a_real_oversized_arc_coordinate_is_still_refused` (`…112000000000 0` and its spaced form both fail).

## Item 1: React finding

`parseSvgPath` scans every match of one number pattern and refuses any above 1e9. It reads `11999999999` as one number, so it refuses a valid compact arc that native accepts. The parser proper already reads compact flags correctly; only the size scan is wrong. Reproduced by the new fixture: it throws “path has coordinates too large to draw”.

## Item 1: smallest implementation

Port `number_past` as a private function in `src/engine/svg-path.ts` and call it in place of the pattern loop. Keep the existing React error text and the later finite checks. Hazards to preserve:

- Iterate by Unicode scalar, as Rust `chars()` does.
- Rust `str::parse::<f64>` rejects `""`, `"."`, `"-"`, `"1e"` and `"1e-"`; JavaScript `Number("")` is 0 and the others are NaN. Accept a token only when it has the decimal-number shape, then convert. The scanner never builds `inf` or `nan` text, so the NaN branch is unreachable here; overflow such as `1e999` becomes infinite in both languages and refuses.
- The flag rule applies only while the pending token is empty.

## Item 1: acceptance

- `tests/parity/svg-path.test.ts`: the two native cases; repeated and relative arcs; a comma between flags; the same digits as a radius, a rotation or after another command remain one oversized number; exactly 1e9 passes and 1e9 + 1 fails; `M.5.5L1e9-1e9` reads as four numbers.
- Full pure suite, strict types and builds.
- Browser: the existing SVG open, drop and paste workflow and the SVG export cases must still pass; add a pasted compact-arc path to the SVG import workflow if the fixture harness can carry one without a new file.
- Update `docs/parity/cross-repository-mapping.md` and the delta queue row with the verified revision.
