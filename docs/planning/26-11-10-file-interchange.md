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

At 48f7fc7 all 306 production Chromium workflows passed in 607.3 seconds with no skips or flakes. Strict types, both production builds, 2,050 pure tests and both local Auth integrations passed. Against six independent native files, decoded lossless WebP matched all channels in sRGB and Display P3. Baseline JPEG kept full chroma resolution and composited transparency over white. Mean absolute differences per channel at quality 20 were 1.58 (sRGB) and 0.84 (P3), and at quality 90 were 0.25 and 0.46. The largest individual differences were 43, 26, 10 and 8 levels respectively. The signed-in host downloaded both real formats. The separately loaded JPEG module is 175 kB gzipped in the Vite production build, including its worker and encoder.

## Saved export settings and batch delivery

Eight pinned Rust sessions cover preset creation, editing, deletion, errors before mutation, undo, page metadata, suffix cleaning and the distinction between node.set and archive fields. Six further native sessions supply batch job names and skipped counts, including repeated layers, path sanitisation, scale suffixes and implicit icon assets. The inspector uses the existing thumbnail painter. Web downloads flatten a single file's suggested name and preserve folders in a multi-file ZIP. The 1,000-member native limit and 256 MiB combined encoded member budget apply. Saved PDF, SVG and VectorDrawable options survive file exchange while their output encoders are in progress.

Both builds, strict TypeScript, 2,065 pure checks and both Auth integrations passed. Chromium exercised persisted settings, preview, page PNG, single-file and batch downloads, separate command payloads and archive contents. A 3,840 × 2,160 JPEG of one flat rectangle encoded in 512 ms, occupied 163,042 bytes and left zero encoder workers. The first recovery test reloaded before the device reported its debounced write. Waiting for the visible saved acknowledgement made the recovery scenario deterministic.

The local Graphify refresh covered the working tree based on 48f7fc7 and the pinned Rust source at a2e87433. React supplied 5,248 nodes and 23,412 edges. The combined index contained 32,886 nodes and 110,590 edges, including export_jobs, export_setting, layerExportJobs and editExportSettings. Four top-level test modules produced no graph symbols and were checked directly.

## SVG execution checkpoint

Rust file.exportSvg delegates to file.export with format SVG. It uses the selected crop and world transforms, always writes sRGB vectors, ignores raster pixel scaling, and refuses visible descendant depth past 256 before calculating bounds. The SVG writer shares one ID namespace across named layers, paints, clips, masks and filters. Begin with selected geometry, layer ordering, editable path commands, vector regions, grouping, masks, crops, strokes and colour conversion. Compare XML structure and independently decoded browser pixels with native files. Then cover embedded images, pattern sources, live text, text outlines, effects, clipboard and import. Use the upstream import corpus and budget and hostile-input suites for the importer.

At ded054a, all 23 independent native SVG fixtures matched Chromium pixels, including live and outlined text, masks, pattern sources, transformed gradients, named groups and bounds. Twenty-two files also matched the XML byte for byte. One outside rectangle stroke omitted native zero-length cubic segments. Authenticated direct and saved SVG downloads passed. Strict types, both production builds, 2,088 pure checks and both local Auth integrations passed.

The first full browser run at 62612ad returned 276 passes, one failure and 32 unexecuted serial checks. Duplicate React keys allowed a stale layout guide inspector to survive a selection change. Distinct panel keys fixed the regression. The original scenario passed twice in isolation. At ded054a all 311 production Chromium workflows passed in 595.4 seconds with one worker, zero skips, retries or flakes. Active work is native SVG filters, shadow geometry and effect images, followed by clipboard and SVG import.

At ded054a and upstream a2e87433, local Graphify indexed 5,289 React nodes and 23,697 edges. The combined index held 32,927 nodes and 110,870 edges and resolved renderSvgExport and try_export_svg to their respective sources. The top-level SVG parity test produced no symbols and was checked directly.

## SVG effects and clipboard checkpoint

At 018afe6 the export writer emits editable native blur and shadow filters, native dash fits per subpath and PNG images for progressive blur, grain, texture, glass, backdrop and effect patterns. The signed-in Edit and canvas menus copy SVG text and the 2× sRGB PNG. Ordinary Copy and Cut mirror text or SVG and retain editable layer data across file tabs. A newer system clipboard takes precedence. The depth guard extends through referenced pattern vectors and raster cells.

The pin supplied 15 filter and shadow cases, seven dash cases and ten effect-image files. All 45 vector fixtures matched Chromium pixels. All ten effect-image files matched native XML structure after removing the PNG payload. The maximum observed premultiplied channel error was ten levels and the largest per-scene mean was 0.221. Strict types, library and Next.js production builds, 2,112 pure tests and both Auth integrations passed. Five focused Chromium workflows passed, including OS clipboard writes and shared nesting budgets. At 018afe6 all 314 production Chromium workflows passed in 602.8 seconds, with zero skips, retries or flakes. Both builds, strict TypeScript, 2,112 pure checks and two local Auth integrations passed. The combined local graph contained 32,977 nodes and 111,186 edges, including 5,339 React nodes and 24,018 React edges.

## Editable SVG import execution order

1. Replay the 22 upstream SVG corpus files through the pinned Rust file.import and file.saveAs. Retain the source SVG, reported warnings, archive structure and marked pixel probes. Add malformed documents, implicit sizing, anonymous and named groups, DTD cases and resource limits.
2. Map svg::import::{looks_like_svg,nesting,import_within}, budget::{document,resolver} and usvg viewport transforms to bounded SVG/SVGZ decoding, XML parsing and viewport conversion in TypeScript. Use an inert XML document, never load external resources and track expanded references separately from source size.
3. Map shape::{recognize,place}, import::{group,path,primitive,closed_for_fill,stroke_props} to editable shapes, paths, group fitting, hierarchy, strokes, viewBox, units, visibility and CSS. Check document data and probes before adding paint servers.
4. Map paint, fx, text, masks, images, reusable symbols and patterns to the existing document, shaping and image models. Compare independently reconstructed layers, resources and rendered pixels across the corpus.
5. Wire file.open, file.import, drop, paste and file picker. Verify centre placement, native history, single-step undo, recovery, navigation and atomic failures. Repeat the complete local gate before leaving row 12. Continue remaining interchange and roadmap work.

At c14f32a the importer maps SVG, SVGZ and external clipboard artwork to editable frames, groups, native shapes, vector networks, text styles, gradients, image fills, pattern tiles, masks and blur or shadow effects. Chromium replayed all 22 upstream corpus SVGs and six extra cases against independently captured native file imports. Every one of the 174 original pixel probes passed its upstream tolerance. Native and browser layer IDs, hierarchy, geometry, style records, warning arrays and resource dimensions matched the checked fields. The two rasterised pattern tiles have different PNG encoding and therefore different byte-derived resource keys. Embedded original image keys matched exactly. Opening, dropping, pasting, undo and saving then reopening passed in the signed-in production host.

Strict types, both production builds, 2,115 pure checks and two local Auth tests passed. All 316 production Chromium workflows passed in 606.8 seconds with no skips, retries or flakes. Remaining SVG checks include colour functions and document profiles, hostile input limits, text paths and outlines, nested viewports, image and pattern transforms, reference expansion and native round trips. The local graph at c14f32a contained 5,444 React nodes and 24,638 React edges, with 33,082 nodes and 111,793 edges across both repositories. The top-level SVG XML test module was checked directly.

## Android VectorDrawable execution order

Reuse the verified export crop, colour conversion, path geometry and text shaping. Capture pinned engine file.export results first. Compare crates/vectordrawable/src/xml.rs and warnings.rs with the TypeScript XML writer and warning order, then paint.rs with handle projection and rotated sweep stops. Map walk.rs, text.rs and stroke.rs to scene traversal, clipped masks, glyph outlines, opacity and stroke areas. Exercise all three compatibility modes, attachment to saved export jobs, the signed-in download and export depth. Verify non-identical path representations by rendering their drawables.

## Editable SVG import and Android verification

At 4ba2da0 Chromium matched the checked records for 55 more pinned SVG imports. Pure checks cover 88 native colour and warning combinations. All 22 corpus inputs completed two editable round trips. Their maximum mean channel differences were 0.251854 and 0.002271 respectively. A 5,000-rectangle input produced 5,001 layers in 111 ms with three timer ticks. Hostile XML, bounded SVGZ expansion, nested references and superseded imports passed. The local graph contained 5,481 React nodes and 24,830 edges, or 33,119 nodes and 111,979 edges across both repositories. Two top-level parity tests were read directly.

At c833a9c 95 of 103 independent Android XML fixtures matched byte for byte. Eight alternative stroke contours matched all other XML attributes and passed per-path 4× Chromium coverage comparisons. The largest mean alpha difference was 0.0873 out of 255. The maximum single-pixel difference was 255 at a corner in the closed dash fixture. The signed-in editor downloaded both direct and saved XML. The local graph contains 5,535 React nodes and 25,164 edges, or 33,173 nodes and 112,306 edges across the two repositories. The combined graph resolves native try_export and React renderDrawable.

At c833a9c all 320 production Chromium workflows passed in 619.8 seconds with no skips, retries or flakes. Both production builds, strict TypeScript, 2,309 pure checks and both local Auth integrations passed. Android XML matched 95 of 103 pinned files byte for byte. Eight alternative stroke contours passed the per-path coverage checks. The largest relative coverage difference was 0.85% on a curved dashed path.

## PDF execution order

1. Capture pinned engine file.export, file.exportFramesPdf and file.exportLayers output. Use an independent reader to extract the page count, page boxes, text, links, image and colour resources. Rasterise reference pages for visual comparisons.
2. Port export.rs page selection and pdf::{lib,print}. Preserve frame reading order, explicit selection order, trim versus paint bounds, bleed, registration marks and rejection before recursive bounds. Render vector geometry and compare colours, page layout and clipping.
3. Port pdf::{draw,text,raster}. Compare gradients, paint layers and brushes, masks, isolated groups, embedded selectable glyphs, link annotations, adjusted images and bounded effect images. Retain real vector content and preserve the tested text and print semantics.
4. Wire the single-file, frame and batch commands, inspector, downloads and cancellation. Inspect the output with an external PDF reader and verify the signed-in flow. Resume the remaining interchange codecs.

## Imported pages and REST documents

All supported editable design formats use the same page-append transaction. At the PDF checkpoint the combined local graph resolves append_pages and Renames in the Rust file commands, plus adoptClipboardComponents and localiseComponent in React. The page importer must copy every page and eligible library definition, including ones outside the selection. Clipboard paste has different allocation, placement and component-link behaviour.

1. Replay native file.open, file.import and file.saveAs with controlled destination and source archives. Check layer, page and asset ID allocation, conflicting styles and variables, references, library records, images, the current page, selection and undo. Check identical assets, indirect conflicts through aliases, duplicate external keys and source files with histories or branches.
2. Implement the immutable append operation using the existing document, variable and component types. Route file.import and drops of native documents through it. Stage resource validation, cancellation and history before publishing one edit. Reopen the downloaded result and compare the verified fields.
3. Implement REST file and nodes-response recognition, pages, geometry, layout, paint, effects, text, masks, components, variables and styles. Reuse the existing REST variable parser. Resolve image references from supplied resources. Match native placeholders and counted warnings. Check depth, area, hostile keys, wide inputs and concurrent replacement.
4. Run file and clipboard format checks on the later Fig/Jam, Sketch and Penpot readers. Revisit section, prototype and board fields when their destination models land. Verify their final round trips before the whole-product gate.

Native page appending passed at 6d643af. Twenty-four independent native sessions cover blank and existing destinations, repeated imports, conflicting styles and variables, linked component stores and documents with history. The full local release gate passed all 324 Chromium cases in 427.4 seconds. REST file and nodes-response decoding is in progress.

At 2fdd1c4, 40 supported REST fixtures matched the complete decoded layer tree, pages, allocator, variables, styles, image keys and warnings. The archive carrying a Section and Slice remains open. Chromium verified the real folder drop with original image bytes and variable definitions. The local graph included the initial uncommitted Kiwi reader, with 5,838 React nodes and 26,832 edges, or 33,476 nodes and 113,951 edges across both checkouts. The merged graph resolves import_with_networks, importRestDocument and droppedDesigns. The top-level native fixture comparisons were checked directly.

## Binary Fig and FigJam execution order

1. Capture file.export followed by a fresh native file.open and file.saveAs for representative documents. Cover zipped and bare canvases, metadata naming, image members, editable layers and changes of order. Include corrupt headers, compressed chunks, truncated schemas, recursive definitions and value budgets. Keep the emitted file distinct from the expected re-imported archive.
2. Map fig::decode_canvas and fig::kiwi to a bounds-checked TypeScript reader. Resolve field IDs against the schema carried by each file. Preserve integer precision, first-field semantics, structural depth, declared array length and expanded-byte limits. Compare imports across deflate, zlib and Zstandard frames.
3. Map fig::map::to_rest to the existing REST importer, including sibling positions, original GUIDs, editable networks, component expansion and hidden library dependencies. Compare archived objects and warnings, then exercise open, append, drop and cancellation in Chromium. Map board-only data after the board model lands.
4. Map the native Fig writer separately. Use an independent native reader to verify browser output before reporting export parity.

At 8a5c831 the reader matched 80 supported upstream re-imports, including the original ZIP image bytes and bare-canvas placeholder pixels. All 329 production browser workflows passed. Next compare 15 additional native component cases, preserve field-level instance scaling and fitted geometry, resolve nested sources and historical keys, then verify internal library stores. Continue with the writer and omitted document models before the final audit.

At 5987f3a, all 26 additional component comparisons passed. The signed-in production host preserved the hidden library store and nested contextual source IDs after saving three drawings. Continue with binary text-path networks and saved wrap positions, then complete remaining import and export mappings.

At f7a9bbb, text path and saved-wrap properties passed in all 32 source files. Compare native reopens of browser-written Fig files, extend the writer through editable text, vectors, layout, styles, variables and linked components, then verify the host download and foreign file integrations.

At 4709475 all 101 browser-written Fig fixtures matched independent upstream reopens. The signed-in download, whole-document selection, cancel-on-sign-out and worker responsiveness passed. All 333 production browser tests passed in 487.2 seconds. Row 12 continues with [Sketch import](26-11-10-sketch-interchange.md), Penpot, remaining output formats and deferred interchange records when their destination models are available.

At 5d94730, All 336 production Chromium workflows passed in 515.1 seconds with zero skips, retries or flakes. Strict TypeScript, both production builds, 3,044 pure checks and two local Auth integrations passed. The Sketch corpus and Slice property checks passed. Continue with [Penpot offline import and export](26-11-10-penpot-interchange.md). [Sketch evidence](../reports/26-11-10-sketch-interchange-parity.html).

## External design clipboard

Penpot export reached the native reopen checkpoint at 8c07e01. The next acquisition route combines the Fig reader and the existing cross-file clipboard transaction. Compare 46 independent native paste sequences, including bare data, HTML, placement in a selected frame, repeated paste and undo. The Section and Slice fixture requires the shared Section model and reader. Signed-in browser checks must cover clipboard priority, malformed markers, resource warnings and cancelled edits. [Current action](26-11-07-full-port-resume.md#continue-from-here).

At e399303 all 46 native paste sequences passed. Section identity, hidden contents and nested Slice survive REST, Fig, native saves and clipboard transactions. Both independent deep hits and three focused signed-in workflows passed. Continue with Section authoring and PDF traversal. [Property matrix](../reports/26-11-10-design-clipboard-parity.html).

At 80f52d5 the Section authoring and nested frame PDF checkpoints passed 32 engine cases and three signed-in browser workflows. The preceding release passed 342/342 production workflows. Continue with the user-facing Import report and the remaining interchange command audit. [Section verification](../reports/26-11-10-file-interchange.md#section-authoring-and-frame-pdf).

At bbc26fd the persistent Import report passed its native rule matrix and signed-in open, append, place, paste, ownership, dismissal and sign-out scenarios. The Section screenshot regression changed only toolbar rows 727–788 in 14 references. The 15 full-canvas scenarios passed. The full release is running. Next compare native `codegen::code_for(Css)`, `edit.copyAsText` and `edit.copyLink` against the user clipboard and control-channel fence. [Import report matrix](../reports/26-11-10-import-report-parity.html).

## Clipboard code and node link verification

Upstream `menus::invoke` uses `codegen::code_for(Css)` on the first selected layer, joins the characters of selected text layers with a newline, and formats the first node ID as a Figcraft link. The Edit menu offers all five copy formats. The canvas menu offers CSS, SVG, PNG and link. A synthetic invocation can acknowledge the command while leaving the system clipboard untouched. Compare both menus through actual clipboard reads, including a mixed selection, empty text, unsigned 64-bit identifiers and a synthetic click.

Independent `inspect.code` output from a2e87433 covers 1,557 layer IDs in 393 native design saves plus four IDs in a purpose-built file with a comment delimiter, quoted font family, RTL, font decoration and letter spacing. Reuse the shared variable CSS names, paint, effect, font and transform models. Keep multi-language code generation, code connections and the Inspect UI in row 17. The node link remains an interoperable Figcraft URL. Browser link activation belongs to the host navigation audit.

## Clipboard and one-off PDF print controls

At `e05748c`, first-layer CSS matched 1,561 native outputs across 394 files. Signed-in Chromium verified mixed text, the exact 64-bit node link, trusted clicks and synthetic clipboard refusal. The one-off PDF matched the native 72 dpi rendering and both page boxes. Empty-page feedback, per-workspace retention and frame-export isolation passed. Strict TypeScript, both production builds, 4,073 pure tests and two local Auth integrations passed. The dependency audit reported zero vulnerabilities. The combined local graph contains 34,350 nodes and 118,427 edges. The preceding Import report release passed all 345 browser cases. The full 0.54.0 regression is running. [Property checks](../reports/26-11-10-clipboard-code-parity.html).

All 347 local production Chromium workflows passed in 1,110.1 seconds with one worker, zero skips, retries or flakes at `1a53341`. The preceding run passed 122, timed out on a page-wide fieldset selector and left 224 serial tests unexecuted. The fix scoped the rectangle workflow to its named controls and preserved its existing screenshot. The active slice is [online file ownership](../planning/26-11-10-online-file-ownership.md).
