# Upstream delta row 3, item 9: a background blur or glass exported on its own

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `e183f76`. **This bounded item passes. Nine items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2213 (`020388cf`, `a1de7dcd`): an export of layers draws only those layers, so a background blur or glass in them read an empty backdrop and exported almost blank. Native now renders the page beneath the first exported layer as the backdrop those effects read.

- **The seed.** [`renderRasterExport`](../../src/engine/canvas.ts), which serves `file.export` and each raster job of `file.exportLayers`, looks for visible layers with a background blur or glass in the drawn layers. When there are some and the export is contents only, it renders the page beneath the first drawn layer, padded by the furthest those effects reach, over the export area. The page beneath is the existing "beneath" document, moved to [backdrop-document.ts](../../src/engine/backdrop-document.ts): the first drawn layer and everything painted after it are hidden, at every ancestor level, and ancestor strokes are cleared. The seed is painted in the document's colour space; conversion and JPG flattening stay at encoding.
- **Reading it.** [`renderAreaPixels`](../../src/engine/canvas.ts) links the export surface to the seed with `backdropParent` while it paints, so the effects' existing `readBackdrop` reads it under the transparent surface. Only the drawn layers are painted; the output keeps its size.
- **What stays.** Without a backdrop effect, with contents only off (which already draws the page) and for Copy as PNG (an explicit drawn list, as native `copy_png` uses `render_area`) nothing changes. [export-area.ts](../../src/engine/export-area.ts) now passes the page's layers and the contents-only flag through the raster plan.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-backdrop-export.json](../../tests/fixtures/native-backdrop-export.json) | Eight scenes, each exported natively alone and with contents only off | All sixteen exports match native within 2 units per premultiplied channel (the largest difference measured is 1), and the native tests' own probe assertions hold on the port's output. Seven of the eight alone exports failed before the change; the scene without an effect passed already |

[Provenance and reproduction](../../tests/fixtures/native-backdrop-export.provenance.md).

The same browser case checks that a saved export setting exported with `file.exportLayers` equals native's alone export, and that Copy as PNG of the blurred pane copies clear, as native's `render_area` does.

## Recorded differences

None measured beyond one unit per channel.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/file.rs::export_file` | `canvas.ts::renderRasterExport`, `exportBackdrop` |
| `crates/engine/src/cmd/file/export.rs::backdrop_layers` | `export-area.ts::exportRegion` (`pageLayers`) |
| `crates/render/src/lib.rs::{render_area_over, area_at}` | `canvas.ts::renderAreaPixels` (`under`) with `backdrop-stack.ts::backdropParent` |
| `crates/render/src/backdrop.rs::{hide_above, render_beneath}` | `backdrop-document.ts::beneathDocument` |

[Property matrix](26-11-24-isolated-export-backdrop-parity.html) · [Plan](../planning/26-11-24-isolated-export-backdrop.md) · [Browser](../../tests/e2e/raster-export.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `e183f76`, native reference `bad07e44` |
| Failing fixtures first | Seven of the eight alone exports failed before the change |
| Full pure suite | 5,498 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 411 cumulative Chromium cases passed in one 16.7-minute run at `e183f76` with zero skips, retries, flakes or suite errors: the 410 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 15.18 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,829 nodes/37,691 edges at `e183f76`; native 28,939/92,127 at `bad07e44`; combined 37,768/128,635. `exportBackdrop`, `beneathDocument`, `renderAreaPixels`, `render_area_over` and `backdrop_layers` verified. |

## Reproduction

```sh
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/raster-export.spec.ts -g "background blur or glass exported on its own" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

The comparison runs in a browser canvas, so it has no pure test. Serve the production preview on port 3101 as the handover describes for the browser cases. The native observations reproduce from the provenance file.

## Remaining gaps

- SVG and PDF exports keep their own per-effect backdrop path (`export-effect-raster.ts::backdropPixels`), as native dispatches them separately.
- A JPG or WebP export with a backdrop effect was not observed; it takes the same seed before encoding.
- Row 3 continues with item 10, export bounds and import budgets.
