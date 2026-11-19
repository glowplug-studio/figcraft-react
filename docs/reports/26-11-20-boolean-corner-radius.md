# Upstream delta row 1, item 5: a boolean group's corner radius rounds its result

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `3c14182`. **This bounded item passes with one recorded difference in a neighbouring component. Two items of row 1, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2222 (`c48d844d`, `4c91f908`, `529134b8`, `bae366ba`, `ec105d0f`) gave a boolean group a corner radius. The group's operands are folded as before, then every sharp corner of the result is rounded with the group's first radius: convex corners are cut off and concave ones filled in. Corner smoothing applies between straight edges.

- [round-corners.ts](../../src/engine/round-corners.ts) is a direct port of native `pathops::round_corners`.
- [`booleanResult`](../../src/engine/boolean-result.ts) rounds the fold when the group's radius is positive. The vector it returns carries no radius of its own, so nothing rounds twice. Rendering, hit testing, masks, strokes, Flatten and every export follow, because they all read the group through this function.
- [corner-fields.ts](../../src/engine/corner-fields.ts) holds native's three kind rules (which layers take a radius, which round each corner on its own, which take smoothing) and what the Design panel's corner rows show. [CornerPanel.tsx](../../src/CornerPanel.tsx) now uses it.
- Paste properties, the REST importer, its variable-binding filter and the `.fig` exporter each kept their own list of kinds with a radius. All four now include boolean groups.

`node.set cornerRadius` already stored a radius on a boolean group and `node.get` already reported it as native does; only the drawing was missing.

## Observable effects

- A boolean group with a radius draws rounded, on the canvas and in exports.
- Selecting a boolean group shows one Corner radius field. It reads the radius the group draws, even if a script left other per-corner values. With a rectangle at another radius the field reads Mixed. The toggle opens Corner smoothing only.
- Paste properties, a bound radius variable, REST JSON and `.fig` files carry a boolean group's radius.
- Two changes outside boolean groups follow from the same native rules: a text or slice selection no longer shows the Corners panel, and a section opens Individual corners.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-round-corners.json](../../tests/fixtures/native-round-corners.json) | 16 inputs, 38 results of native `round_corners` at full precision | All 38 match: folds of lines to nine decimals, folds with curves to four. The nine unchanged results return the input path itself |
| [native-boolean-radius.json](../../tests/fixtures/native-boolean-radius.json) | Ten command sequences with every receipt and exported SVG | All `node.get`, copy, paste and variable receipts are equal. Rounded outlines hold native's segments in native's order, from another start vertex; see below |

[Provenance, sources and reproduction](../../tests/fixtures/native-round-corners.provenance.md).

Seven native tests are restated without a new observation, because they state their expectation in the source at the pinned revision: the two render tests (pixels and areas of the rounded L, and that a new radius reuses the fold), the REST import test, the `.fig` round-trip test and three Design panel tests. The native panel cannot be driven headless here.

## Recorded differences

- **Exported outlines start at another vertex.** Native's path normaliser and the port's begin a contour at different vertices, and native writes straight pieces as lines. The engine cases compare rounded outlines segment by segment whatever vertex they start at. Where no radius is set, the two also differ in points left along straight edges. This belongs to boolean normalisation, predates this item and is in the final-audit queue.
- **Corners beside a curve agree to four decimals, not nine.** Such a corner is cut by arc length, and the port and Kurbo measure a cubic's length by different quadratures.
- **Relative edits** typed into the native radius field (`+10`) have no counterpart in the port's number inputs. This predates the item and belongs to roadmap row 19.
- **A section has four radius handles on the native canvas and none in the port.** Found while reading the native handle rule; not part of #2222, and added to the deferred review queue.

## Native mapping

| Native | React |
|---|---|
| `crates/pathops/src/round.rs::{round_corners,round_subpath,clean,merge_runs,trim,start_direction}` | `round-corners.ts` |
| `crates/render/src/boolean.rs::result_cached` | `boolean-result.ts::booleanResult`, `asVector` |
| `crates/doc/src/node.rs::{has_corner_radius,has_independent_corners,has_corner_smoothing}` | `corner-fields.ts` |
| `crates/ui-egui/src/panels/right/paints.rs::appearance` corner rows | `corner-fields.ts::cornerFields`, `CornerPanel.tsx` |
| `crates/engine/src/cmd/edit/clipboard.rs::apply_copied_props` | `property-clipboard.ts::pasteLayerProperties` |
| `crates/format/src/rest.rs`, `rest/variables.rs::applies` | `interchange/rest/properties.ts`, `interchange/rest/bindings.ts` |
| `crates/format/src/fig/export/layer.rs` | `interchange/fig/write-document.ts` |

[Property matrix](26-11-20-boolean-corner-radius-parity.html) · [Plan](../planning/26-11-20-boolean-corner-radius.md) · [Corner parity](../../tests/parity/round-corners.test.ts) · [Engine parity](../../tests/parity/boolean-radius.test.ts) · [Fold reuse](../../tests/parity/boolean-radius-cache.test.ts) · [Panel](../../tests/unit/CornerPanel.test.tsx) · [Browser](../../tests/e2e/boolean-geometry.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `3c14182`, native reference `bad07e44` |
| Failing fixtures first | Without the rounding, 10 of the first 11 engine cases and the canvas pixel check failed. The panel case for a group with differing radii, the paste case, both REST cases and the `.fig` round trip each failed before their change |
| Full pure suite | 5,049 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 384 cumulative Chromium cases passed in one 15.6-minute run with zero skips, retries, flakes or suite errors: the 383 earlier cases and the new canvas pixel check. No pixel fixture or screenshot baseline changed, and no existing case depended on the Corners panel showing for text or slices |
| Real local provider integrations | 32 passed in 13.36 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,559 nodes/36,639 edges at `3c14182`; native 28,939/92,127 at `bad07e44`; combined 37,498/127,612. `roundCorners`, `round_corners`, `cornerFields`, `hasCornerRadius`, `has_corner_radius` and `result_cached` verified. |

## Verification corrections retained

- Two sliver segments appeared on two circles united at radius 40 in the first comparison with native. Curves that mirror each other measured a hair apart, so a cut meant to land on a segment's end fell just short of it. The trim now reuses the segment's measured length and snaps a cut within the accuracy of the far end.
- The first comparison expected a new path when nothing rounds. Native returns its input there; the port now returns the same path object, and the test asserts identity.
- The exact wall time of the browser run was not captured by a JSON reporter this time; the figure is Playwright's own summary line.

## Reproduction

```sh
npx vitest run tests/parity/round-corners.test.ts tests/parity/boolean-radius.test.ts tests/parity/boolean-radius-cache.test.ts tests/unit/CornerPanel.test.tsx --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
npx playwright test tests/e2e/boolean-geometry.spec.ts --workers=1 --retries=0
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The normaliser difference above.
- No browser case types a radius into the panel with a boolean group selected. The panel is covered by a static render against the restated native field tests, and the drawing by a canvas pixel check.
- The port keeps the fold's prefixes per group and rounds again when the radius changes; it has no separate bounded map of rounded paths as native has, and no frame budget is measured for scrubbing a radius.
- No native-written `.fig` file with a rounded boolean group was observed; the port reads back its own output.
- Row 1 continues with item 6, path operation budgets (#2249).
