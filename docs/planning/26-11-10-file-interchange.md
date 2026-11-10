# Design interchange and export

## Entry checkpoint

Roadmap row 12 follows the local file workspace release. The fork and upstream main matched a2e87433 on 10 November 2026. The scoped Figcraft Supabase MCP returned the intended project URL. The merged local graph resolves Rust export_area, export_file and adopt_pasted alongside React worldRenderBounds, captureLayers and adoptClipboardComponents. Its 32,800 nodes and 110,284 edges include the current checkout. Direct inspection supplies fixtures and tests without extracted symbols.

## Execution order

1. Port the common export target, ordering, bounds, size and settings used by file.export and layer presets. Compare selected and whole-page exports, hidden layers, nested transforms, contents-only crops, bounding-box crops, errors and oversized output against independent Rust results. Reuse the canvas paint and image pipeline with a transparent output surface.
2. Provide PNG, JPEG and lossless WebP with native output dimensions, alpha, JPEG flattening, quality and profile metadata. Match sRGB and Display P3 conversions and test decoded pixels and container metadata, signed-in downloads and export previews. Verify memory for large files and reject sizes outside the supported budget before allocating a surface.
3. Port editable SVG export and import, including text and outlines, stroke simplification, IDs, gradients, effects, masks, images, symbols, viewBox, transforms and import warnings. Use the same exporter for clipboard mirroring and Copy as SVG. Route external SVG clipboard data and file selection through the importer.
4. Implement layer export settings, slices, multiple-output archives, Inspect assets, folder and suffix rules. Port frame PDF export and print settings, Android VectorDrawable and its compatibility warnings. Validate against native fixtures and external format readers.
5. Port the REST importer with variables and image maps, native import and page appending, and the Sketch, Penpot and Fig/Jam codecs in dependency order. Preserve references, import journals, diagnostics, resource limits, warnings, experimental round trips and external design clipboard data. Audit every upstream entry point and UI control.
6. Run both builds, strict type checks, unit and Auth suites, signed-in production browser and performance regressions. Publish the local property matrix, update the roadmap and enter online ownership and sharing after the interchange gate passes.

The current output for non-text layer copies uses Figcraft's clipboard marker. External SVG, code, PDF and design clipboard encodings remain open. File exchange uses browser-selected bytes and downloads. This row creates no persistent online file records.

Sources include crates/engine/src/cmd/file/{export,open,import_ids,load}.rs, engine export behaviour, performance, depth, profile, JPG, PDF, VectorDrawable and format-specific interchange tests, crates/{doc,render,svg,pdf,vectordrawable,format}, and the UI export, clipboard and import panels. Cross-feature board, prototype, Dev Mode and presentation fields need a repeat audit once their document types exist.
