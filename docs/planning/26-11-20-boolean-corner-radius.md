# Delta row 1, item 5: a boolean group's corner radius rounds its result

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `3c14182`: [report](../reports/26-11-20-boolean-corner-radius.md), [matrix](../reports/26-11-20-boolean-corner-radius-parity.html), [provenance](../../tests/fixtures/native-round-corners.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `f4efc32` on `prompt/full-figcraft-port`.
- Upstream commits, all #2222: `c48d844d` (`round_corners`), `4c91f908` (each contour's size sets its weld tolerance), `529134b8` (a boolean group takes the radius), `bae366ba`, `ec105d0f` (the radius field shows what a one-radius layer draws).
- Files landed: `src/engine/round-corners.ts` (new), `corner-fields.ts` (new), `boolean-result.ts`, `fit-cubic-source.ts`, `property-clipboard.ts`, `interchange/rest/properties.ts`, `interchange/rest/bindings.ts`, `interchange/fig/write-document.ts`, `src/CornerPanel.tsx`; tests `tests/parity/round-corners.test.ts`, `boolean-radius.test.ts`, `boolean-radius-cache.test.ts`, `tests/unit/CornerPanel.test.tsx`, `tests/fixtures/boolean-geometry.ts`, `tests/e2e/boolean-geometry.spec.ts`; fixtures `native-round-corners.json`, `native-boolean-radius.json` and their provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

`crates/pathops/src/round.rs::round_corners(path, radius, smoothing)`:

1. A radius that is zero, negative or not finite, and an open or empty path, return the path as it is.
2. Each closed subpath is cleaned: pieces shorter than a weld tolerance are dropped and straight runs are merged. The tolerance comes from that contour's own size, so a small contour beside a large one keeps its detail (`4c91f908`).
3. Each vertex is judged by its turn. A turn under 1e-3 radians is not a corner.
4. A corner takes at most half of each edge, or what the corner at the other end leaves.
5. A corner between two lines is drawn with `geom::smoothed_corner`, so corner smoothing applies there. A corner beside a curve is one cubic between cuts made by arc length on both sides.
6. When no corner of any subpath rounds, the input path is returned.

`crates/render/src/boolean.rs::result_cached(operands, radius, smoothing)` folds the operands, then rounds the fold with the group's first radius when it is positive. The rounded path is cached apart from the fold, so a new radius does not redo the boolean steps.

`NodeKind::has_corner_radius` gains `BooleanOp`; `has_independent_corners` does not. Every caller follows:

| Native caller | Effect for a boolean group |
|---|---|
| `ui-egui/panels/right/paints.rs::appearance` | One Corner radius field; the toggle opens Corner smoothing only, with no per-corner fields. The field shows `radii[0]` for layers with one radius, and a value only when all four agree for rectangles, frames and sections |
| `engine/cmd/edit/clipboard.rs::apply_copied_props` | Pasted properties keep the radius and smoothing |
| `format/rest.rs` | REST JSON `cornerRadius` and `cornerSmoothing` are read |
| `format/rest/variables.rs::applies` | A radius variable bound in REST JSON is kept |
| `format/fig/export/layer.rs` | `.fig` export writes `cornerRadius` and `cornerSmoothing`, without the per-corner fields |
| `engine/canvas/shape_handles.rs` | No canvas radius handle: only polygons, stars and layers with independent corners have them |
| `engine/dev/devinspect.rs` | A Radius row (Dev Mode, unported roadmap row 17) |

## What the port had

- `corners` is a property of every layer; `node.set cornerRadius` already stored it on a boolean group and `node.get` already reported it as native does.
- `booleanResult` drew the fold and ignored the radius.
- The Corners panel was shown for every kind except groups, ellipses and lines, read Mixed whenever any of the four radii differed, and treated only rectangles and frames as having independent corners.
- Paste properties, the REST importer, the REST binding filter and the `.fig` exporter each listed the kinds that take a radius, without boolean groups.
- The `.fig` importer goes through the REST property reader, so one change covers both. The native file codec already reads and writes `corners` for any layer.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `pathops::round::{round_corners,round_subpath,clean,merge_runs,trim,start_direction}` | `src/engine/round-corners.ts` | 38 native results in `native-round-corners.json` |
| `render::boolean::result_cached` | `boolean-result.ts::booleanResult`; `asVector` drops the group's radius from the drawn vector | Ten native command sequences in `native-boolean-radius.json`; native render test restated as a canvas pixel check; fold reuse restated with a counted `booleanStep` |
| `NodeKind::{has_corner_radius,has_independent_corners,has_corner_smoothing}` | `src/engine/corner-fields.ts` | `tests/unit/CornerPanel.test.tsx` |
| `paints.rs::appearance` corner rows | `corner-fields.ts::cornerFields`, `src/CornerPanel.tsx` | The same file, restating `field_tests.rs` and `corner_individual_tests.rs` |
| `clipboard.rs::apply_copied_props` | `property-clipboard.ts::pasteLayerProperties` | Two observed command sequences |
| `rest.rs`, `rest/variables.rs::applies` | `interchange/rest/properties.ts`, `interchange/rest/bindings.ts` | Native REST test restated |
| `fig/export/layer.rs` | `interchange/fig/write-document.ts` | Native round-trip test restated |

## Hazards and known differences

- The port's normaliser and native's start a contour at different vertices and native writes straight pieces as lines. Rounded outlines are compared segment by segment whatever vertex they start at. Unrounded exports of an L differ in points left along straight edges; that predates this item and stays in the final-audit queue.
- A corner beside a curve is cut by arc length. The port and Kurbo measure a cubic's length by different quadratures, so results on curved folds agree to four decimals, not nine. Two curves that mirror each other can measure a hair apart; the trim reuses the segment's measured length and snaps a cut within the accuracy of the far end, or a sliver segment appears.
- The group's vector must carry no radius of its own, or consumers that round vectors would round it twice.
- The panel rule also changes two things outside boolean groups, both following the same native functions: a text or slice selection no longer shows the Corners panel, and a section opens Individual corners. The cumulative browser gate passed with no existing case depending on the old rule.
- Relative edits typed into the native field (`+10`) have no counterpart in the port's number inputs. This predates the item and belongs to roadmap row 19.
- A section has four canvas radius handles in native and none in the port. Found here, not changed: it is not part of #2222 and is queued with the review items.

## Acceptance

- All native results in both fixtures match; the restated native REST, `.fig`, render and panel tests pass.
- Each new case failed before its change: the engine cases without the rounding, the canvas pixel check without the rounding, the panel, paste, REST, binding and `.fig` cases without their changes.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, row 1 plan and delta queue.
