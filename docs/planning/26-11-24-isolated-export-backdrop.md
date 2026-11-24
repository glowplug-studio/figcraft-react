# Isolated raster export backdrop (#2213)

## Execution checkpoint

- Preliminary source review for [delta row 3, item 9](26-11-21-delta-row-3-files-text-paint.md), [ledger 3.15](26-11-20-upstream-delta-ledger.md). Wait for the cumulative gate for items 7 and 8 and record native runtime observations before implementation.
- Native reference `bad07e4433240cad046589129c084bd2fc36f097`, with changes `020388cf1f9cde2a2f8ab2361abbc3003ca7106b` and `a1de7dcd2683d18f90ecfcd92fc2c31ae4c7afa2`. React source read at `906fee8` on `prompt/full-figcraft-port-pending`. Last verified cumulative browser gate was at `a99608c`, as recorded in the [handover](26-11-07-full-port-resume.md).
- Source and tests remain untouched. No build, test or native observation ran. Used existing local Graphify indexes to locate the Rust and TypeScript symbols and checked their definitions in source. Index metadata records `ea403f6` and the pinned native revision. The React graph file is newer than its revision metadata, so use it as a symbol lookup during the current gate.
- Native cases observed on 24 November (below); design settled (below). Implementation follows the items 7 and 8 gate.

## Native source contract

Reviewed `7bf098d7..bad07e44` for the five owning source and test files below. Only `020388cf` changes the backdrop export path. `a1de7dcd` adds the nested-frame case. The other changes there cover invalid targets (`db1bec08`, already mapped to `checkExportTargets`), export settings and profile text (`6c3ac0c5`, `3f39154a`, `297426c5`, `97f086e0`), a file snapshot re-export (`7b34dbab`) and a boolean renderer test registration (`529134b8`). `render/src/backdrop.rs` has no changes in the range.

- `engine/src/cmd/file.rs::export_file` applies the change to PNG, JPG and WebP. `file.export` and each `file.exportLayers` job reach it. The output area, scale, profile conversion, JPG flattening and encoding follow their existing rules. `contentsOnly: false` already draws the page's top-level layers. SVG, PDF and Android XML dispatch separately. Native Copy as PNG uses `copy_png → render_area`, and plain node renders also use the unseeded path.
- `engine/src/cmd/file/export.rs::{backdrop_layers,drawn_layers,export_area}` derive the source page from the **first input ID**. The seed cutoff is the **first drawn root** after existing slice substitution, root reduction and document-order sorting. The cutoff can differ from the first ID supplied by the caller. A frame-contained slice draws its container and a page-level slice can draw the whole page even with `contentsOnly: true`. Preserve those existing target rules. The backdrop consists of layer pixels from that page, with a transparent base and no page paint or editor checkerboard.
- `render/src/lib.rs::{render_area_over,area_at}` allocate the transparent output at the original bounds. They find the largest device-pixel padding among visible nodes with enabled glass or positive-radius backdrop blur in the drawn subtrees. The seed pass expands each side by that padding at the export scale and aligns its origin to the output pixel grid. The resulting surface is available only to backdrop reads via `backdrop::Under`, offset by the padding. As the selected roots draw, later effects also read earlier exported pixels. The output canvas and the effect outline clip what is written. Pixels outside the export rectangle can still contribute to samples inside it.
- `render/src/backdrop.rs::{hide_above,render_beneath}` render a temporary document with the cutoff layer and the layers painted after it hidden. The walk removes later siblings at each ancestor in paint order, including reversed auto-layout order, and clears ancestor strokes that would paint over the children. Running the surviving ancestry through the usual renderer supplies ancestor fills, transforms, clipping and compositing to the seed. The selected roots then draw from their parents' world transforms as before. The change supplies no new ancestor clip on the exported roots themselves. Vector `effects_beneath` can clear samples outside `keep`. Raster `area_at` does not apply that input clip.

## React candidates

| Native owner | React path and candidate target |
|---|---|
| `cmd/file.rs::export_file` and `cmd/file/export.rs::{export,export_layers,copy_png}` | [`editor.ts`](../../src/engine/editor.ts) routes direct exports through `exportRaster` and passes an explicit `drawn` override for clipboard PNG. [`export-layers.ts`](../../src/engine/export-layers.ts) uses `renderRasterExport` for each saved raster setting. Gate the seed at this common raster entry and preserve the clipboard path. |
| `cmd/file/export.rs::{backdrop_layers,drawn_layers,export_area}` | [`export-area.ts`](../../src/engine/export-area.ts) already resolves `contentsOnly`, effective IDs, page, bounds and drawn roots. Carry the relevant page-layer information into `rasterExportPlan` without changing the vector callers' target and bounds behaviour. Keep the requested page and drawn cutoff distinct. |
| `render/src/lib.rs::{render_area_over,area_at,nodes_into}` | [`canvas.ts`](../../src/engine/canvas.ts) owns `renderRasterExport`, `renderAreaPixels`, `drawExportLayers` and the asynchronous image paint loop. Consider an optional seed for this call only, linked under the transparent export surface through [`backdrop-stack.ts`](../../src/engine/backdrop-stack.ts) `backdropParent`. [`backdrop-renderer.ts`](../../src/engine/backdrop-renderer.ts) already provides `hasBackdrop`, `backdropPadding` and the effect reader. Preserve the existing effect and shadow pipeline. |
| `render/src/backdrop.rs::{hide_above,render_beneath,effects_beneath}` | [`export-effect-raster.ts`](../../src/engine/export-effect-raster.ts) `beneath` already clones the node table, hides the cutoff and later siblings, and clears ancestor strokes. Consider extracting that document operation for reuse. Its caller `backdropPixels` is the per-effect SVG/PDF path with `effectView` scaling and optional `keep` clipping. The raster seed needs export-scale sampling through the normal layer renderer. |

Paint both the seed and output in the document colour space. In `renderAreaPixels`, explicitly retain that profile in the seed pass because the default is sRGB. Apply conversion and JPG flattening only when encoding the final image. Align padding in device pixels, using the rounded output dimensions and the same origin offset that `readBackdrop` uses. The native seed sides are clamped to `16,384`, its effect padding to `2,048` pixels. Check canvas allocation, the existing layer budget and teardown of the sampling link and scratch surface across asynchronous image work and failures. Linking a seed beneath the output leaves it visible through backdrop reads only. Painting the seed onto the output would expose unrelated layers in clear regions and change how the selection composites.

## Proposed native observations and focused checks

The tests in `engine/src/export_behaviour_tests.rs` share a red `#E03030` rectangle at `(0,0)` of size `120×120` and a fill-less pane at `(60,20)` of size `120×80`. Record PNG dimensions and decoded RGBA at the following export-relative probes:

| Upstream case | Expected source assertion |
|---|---|
| `exporting_a_background_blur_layer_keeps_the_blurred_backdrop` | Radius `12`, `120×80`, non-zero pixel at `(60,40)` equal to the page render. |
| `exporting_a_glass_layer_keeps_the_backdrop_it_bends` | Default glass, non-zero pixel at `(30,40)` and equality to the page render there and at `(60,40)`. |
| `a_blur_export_is_opaque_inside_the_pane_and_leaves_layers_above_out` | Add a blue `200×200` rectangle above the pane. At `(10,40)`, alpha `255`, red above `150`, blue below `60`. At `(110,40)`, alpha `0`. |
| `a_layer_without_backdrop_effects_still_leaves_the_layers_below_out` | Remove the pane effects. Every output pixel is transparent. |
| `a_blurred_pane_inside_a_frame_keeps_the_frame_and_the_layer_beneath` | Place both nodes inside a white `300×200` frame at the origin. `(60,40)` equals the page render and `(100,40)` is opaque from the frame fill. |

Use the local oracle after the current gate. The harness reads an array of `{name, commands}` cases and returns each command receipt. For the first case, send `shape.rectangle` with the red rectangle's geometry and `props.fill`, `shape.rectangle` with the pane's geometry and `props.fills: []`, `node.set` on the pane with `props.effects: [{"type":"backgroundBlur","radius":12}]`, and `file.export` with the pane ID, `format: "png"`, and `scale: 1`. For the nested case use `frame.create` and `parent` on both rectangles. Confirm command receipts and IDs, and decode each `file.export` receipt's `data` with an independent PNG decoder. Run `file.export` on that same pane with `contentsOnly: false` as a page-render comparison for scenes without an overlying layer, and as a blue-layer control for the scene with one. The exact source assertions can also be run together with the native engine test module after the gate.

```sh
git -C original/figcraft rev-parse HEAD
sh "$HOME/.cache/figcraft-oracle/run.sh" replay < "$CASES" > "$OBSERVED"
CARGO_TARGET_DIR="$NATIVE_TEST_TARGET" cargo test --manifest-path original/figcraft/Cargo.toml -p figcraft-engine export_behaviour_tests::
```

The replay command assumes the warm local oracle described in the [handover](26-11-07-full-port-resume.md). The [oracle provenance](../../tests/fixtures/native-ellipse-four-anchor.provenance.md) gives the clean reconstruction procedure. Set `NATIVE_TEST_TARGET` to a disposable target directory outside both checkouts for the optional native tests. Keep new observation data and provenance in `tests/fixtures/`, with the pin, commands, toolchain and decoded results from the native run.

Use [`raster-export.spec.ts`](../../tests/e2e/raster-export.spec.ts) and the existing `replay` and `replayBatch` browser fixture entry points. Restate all five native cases. Observe a padding-sensitive case with the source ending just outside the pane's left edge, then probe the inside edge for borrowed colour. Observe a two-root export with the upper pane listed first and a blue unselected layer between the selected roots, then probe the pane for the red seeded below both. Check a saved-setting export and the whole-page and clipboard controls. Assert that export preserves the drawing and undo state. Use exact dimensions and transparent or opaque controls. Set filtered-pixel tolerances from measured native and Chromium differences, with alpha-aware comparisons. Verify the focused cases before the pure, type, build, cumulative browser and local provider gates in the [handover](26-11-07-full-port-resume.md).

## Native observations, 24 November

Recorded by Claude through the prebuilt `replay` executable at the pin. Each case builds the scene with commands and exports the pane as PNG twice: alone (the default, contents only) and with `contentsOnly: false`, which draws the page's layers in the same area and serves as the page render the native tests compare against. Decoded RGBA at the native tests' probes:

| Case | Export | (10,40) | (30,40) | (60,40) | (100,40) | (110,40) |
|---|---|---|---|---|---|---|
| background blur 12 | alone 120×80 | 224,48,48,255 | 224,48,48,255 | 225,45,45,118 | clear | clear |
| | page | 224,47,47,255 | 224,48,48,255 | 225,45,45,118 | clear | clear |
| glass (default) | alone | 222,46,46,255 | 224,48,48,255 | 225,48,48,101 | clear | 255,255,255,2 |
| | page | the same at every probe | | | | |
| blur with a blue layer above | alone | 224,48,48,255 | 224,48,48,255 | 225,45,45,118 | clear | clear |
| | page | blue 0,0,255,255 everywhere | | | | |
| no backdrop effect | alone | every pixel clear | | | | |
| blurred pane in a white frame | alone | 224,48,48,255 | 224,48,48,255 | 239,157,157,255 | 255,255,255,255 | 255,255,255,255 |
| source ending at x 59, pane from 60 | alone | 204,0,0,5 | clear | clear | clear | clear |
| | page | every pixel clear | | | | |
| two roots, upper pane listed first, blue between | alone 180×150 | clear | clear | 224,48,48,255 | 224,48,48,255 | 223,48,48,241 |
| blur at scale 2 | alone 240×160 | 224,48,48,255 | 224,48,48,255 | 224,48,48,255 | 224,48,48,241 | 223,46,46,198 |

These agree with every native test assertion: the alone export equals the page render at (60,40) for blur and at (30,40) and (60,40) for glass; with a layer above, the alone export is opaque red at (10,40) and clear at (110,40); without the effect it is wholly clear; in a frame, (100,40) is opaque white. The padding case shows the backdrop reaching 1 pixel outside the pane: the pane's left edge borrows a trace of the red the page render does not draw there. The observations and the native PNGs become the fixture when the gate finishes.

## Design

- `renderRasterExport` (direct export and each `file.exportLayers` raster job): when the export is contents only and no explicit `drawn` list is given (Copy as PNG passes one, and native `copy_png` uses `render_area`), find the largest `backdropPadding` among visible nodes with `hasBackdrop` in the drawn subtrees at the export scale. With none, nothing changes.
- With some: render a seed of the page's top-level layers with the first drawn root and everything painted after it hidden (the existing `beneath` of `export-effect-raster.ts`, exported), over the export area grown by that padding on each side, in the document's colour space, with no flattening or conversion.
- Link the export surface to the seed with `backdropParent(surface, seed, pad, pad, 1, "normal")` for the paint only, so `readBackdrop` reads the seed under the transparent surface; detach after painting. The output surface keeps its size and draws only the drawn layers; conversion and JPG flattening stay at encoding.
