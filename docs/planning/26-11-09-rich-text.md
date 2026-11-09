# Rich text and fonts

## Scope and source

Roadmap row 7 covers native text records, Unicode ranges, font resources, shaping, layout, glyph painting and editing. The upstream fork fast-forwarded from 8a7ebc24 to a4251ca89e253ab69a5ee4135bc30bc5f82725ab. Original main, fork main and the submodule agree. The incoming commits change the desktop updater and Cargo dependency metadata. React’s layer-effects release source is f278b1b. The global supported baseline is 8eb0b876.

The combined local Graphify index has 30,480 nodes and 100,764 edges. Verified Rust TextData → TextAutoResize, TextStyle → Paint and DecorationLook, text::layout → natural_ratio and TextLayout. Verified React readNode → transformBounds and renderDocument → drawDocumentFrame. Graph edges do not establish font asset availability, Unicode algorithms, serde defaults, macro-generated command lists or browser rendering equivalence. Use the pinned files and executable fixtures for those contracts. The scoped Figcraft Supabase MCP read succeeded and returned zero public tables. Rich text belongs in the native document. Local browser font permissions belong to the host. File sharing and realtime remain with their roadmap slices.

## Dependency and verification order

| Step | Upstream ownership | React implementation and evidence required |
|---|---|---|
| 1. Native text values and ranges | crates/doc/src/text.rs, NodeKind::Text, font name/weight, axis and paragraph helpers, format’s native node serde | Immutable typed values, exact defaults and native wire representation. Preserve old files, optional style, list, feature, font-axis, path and saved-break fields. Validate sizes, colours and ranges. Index styles and edits by Unicode scalar, convert separately to DOM UTF-16 and grapheme boundaries. Compare mixed scripts, empty ranges, overlapping replacements, runs, inheritance, paragraph splitting and merging with native fixtures. |
| 2. Browser font inputs | crates/text/build.rs, fontdb.rs, apps/figcraft-web/src/local_fonts.rs, engine/src/fonts.rs | Identify required web faces and their licensed, reproducible source before bundling. The native release workflow pins the craft-fonts build input at 37827adc41fd165f9a9234ac40f94dbad353aa69. The web build requires Inter Regular, Inter SemiBold and Noto Sans Georgian Regular when required-font enforcement is enabled. Use immutable identifiers, bounded font caches and browser-local font permission, upload and failure flows. Cover fallback, duplicates, variable axes, async cancellation and missing-font inspection/refit. |
| 3. Shape and lay out lines | crates/text/src/layout.rs, breaks.rs, display.rs and bidi, RTL list, Vietnamese and colour-glyph tests | Browser-safe shaping and explicit metrics, cluster mapping, glyph advances/outlines and visual caret order. Match native line break, case, bidi, grapheme, wrapping, saved breaks, truncation, vertical trim, number/bullet placement, feature and axis behaviour. Verify multiple scripts, missing glyphs, colour emoji, rotated text and fixed font fixtures. Do not use an unverified CSS text box as the document model. |
| 4. Engine and canvas | crates/engine/src/cmd/text.rs, shape creation, get/set/scale, text_edit and text_behaviour/link/tail tests, crates/render text and bounds paths | Create native text nodes and persist them through the existing codec, clipboard, history and recovery. Implement text layout bounds, fill/stroke paints, shadows, masks, selection and rendering. Add text on paths, outlines and export/inspection contracts against their owning implementations. Cached layout must invalidate on content, face, feature, width and style changes. |
| 5. Editor input and controls | Native text tool, canvas editing, IME/key routing, Design typography panel, font and link dialogs, local font interface | Implement click/drag creation, caret and selection geometry, visual arrow movement, word/line selection, composition, typing and delete, clipboard, list editing and URL actions. Match single/mixed selection, typed undo transactions and access revocation. Check keyboard focus, pointer editing and mobile layouts through the signed-in production host. |
| 6. Verification and reporting | Native doc/text/render/engine tests and upstream web font handling | Independent value/layout fixtures, deterministic browser reference images, native save/reopen and real Auth. Measure repeated cursor/selection and text edits in large documents, cache growth, input and frame p95. Record unsupported downstream integrations in the property matrix and master roadmap. Run full builds, types, unit and Chromium suites before publication gates. |

## Hazards and checkpoint

Rust style offsets count Unicode scalar values. DOM selection uses UTF-16 offsets and user edits operate on grapheme boundaries. A glyph, code unit and scalar can represent different spans, especially for emoji, ligatures, combining marks and bidi text. Native stored line breaks carry a layout-content key and width. An unavailable face must not silently reflow an existing file as if its original font had loaded. Build-time external font inputs are separate from the upstream submodule and need their own licence and provenance checks.

The native text value and range checkpoint passed ten focused tests, 1,163 pure tests, strict types and both production builds. Three signed-in Chromium regressions passed against the local production host, covering streamed archive recovery and native pattern paints on layers, strokes and regions. Release 0.48.0 remains the last full browser run (204/204 at f278b1b).

The independent model reads and writes native styles, paints, variation axes, lists, direction, text paths and saved-break records. Pattern source IDs and saved-break keys retain all 64 bits. Editing uses scalar offsets, first-match style lookup, run normalisation and per-paragraph list inheritance. A 200,000-character range test invokes the style edit once. Text nodes still require the font, layout, rendering and editor integrations.

Local Graphify indexed these source changes against Rust a4251ca8. The combined graph has 30,551 nodes and 100,990 edges, including both TextData models, readTextData, replaceTextRange and native layout. Graphify reported no extracted symbols from the two new test files. Vitest executed their cases directly.

### Saved line breaks

At Rust a4251ca8 and React model baseline 12b76c5, the layout key strips appearance and vertical-only fields, normalises the remaining style runs and hashes the UTF-8 serde representation with 64-bit FNV-1a. The independent browser implementation preserves negative zero in key-bearing native text fields, distinguishes float and integer types and writes dynamic map keys in native scalar order.

A separately built read-only native doc crate supplied six fixed reference keys and a deterministic comparison of 4,093 finite binary64 cases. Every key matched. Tests also cover the width tolerance, strictly increasing scalar positions, empty line starts, appearance edits, shaping changes and native JSON reopen. Strict types, both production builds, 1,171 pure tests and two real local Auth checks passed. The latest full browser suite remains 204/204 from the effects release. Local Graphify has 30,565 nodes and 101,038 edges; it identifies textLayoutKey and savedBreaksFor. Rust method bodies and fixture hashes were checked in source and execution.

### Bundled font resources

The two manifests at craft-fonts 37827adc contain five faces selected by the default native web filter. They are Inter 4.1 Regular, Italic, SemiBold and Bold plus variable Noto Sans Georgian. The filter can accept an Archivo SemiBold wordmark, but neither pinned manifest supplies it. All five original TTFs matched their manifest SHA-256 values. The package includes the unmodified faces, both original OFL notices and a stylesheet with private CSS family names. The Next.js editor imports the stylesheet. No font is preloaded.

The local production Chromium host fetched zero font files on editor entry, fetched exactly five on explicit use and reused an already loaded face. Individual glyph advances, ascents and descents matched Figcraft’s native Face::from_bytes and Face::advance at one em for all five. Georgian’s weight 900 and width 62.5 yielded 608 and 413 units for ა, matching Face::advance_at. npm pack includes all assets and licences. The five binary files total 1,901,188 bytes. Both builds, strict types, 1,176 pure tests and the two Auth integration checks passed. The focused browser workflow passed. The first 205-workflow run passed 178, failed one and left 26 serial workflows unrun. The image-picker screenshot differed in its two native select widths. See the shaping checkpoint below. Local Graphify has 30,566 nodes and 101,044 edges and identifies native input_fonts and the React EditorHost. Binary font content and CSS registration are verified separately.

### OpenType glyph shaping

The library entry readFontFaces loads HarfBuzz on demand. ASCII and non-ASCII text can use explicit Unicode scalar cluster numbers, font-unit glyph advances and offsets, OpenType feature toggles and variation coordinates. The face reader supports single faces and bounded TrueType collections. Browser and Node use the same HarfBuzz build through their own asset-loading paths. The clean distribution contains one 444,394-byte shaping WASM file and a 31,436-byte browser wrapper. The package and Next.js resolve the shaper and fonts from npm and local package assets. The pinned Rust source was used to generate independent fixtures. A browser consumer built from the package entry requested WASM once, after first use. The subsetter is excluded from the distribution.

An independently compiled upstream text crate and harfrust 0.13.3 produced seven raw shape_segment reference arrays at a4251ca8. Both Node and Chromium matched every glyph ID, scalar cluster, advance and offset for kerning on/off, a contextual arrow substitution, a decomposed accent and missing glyph, RTL mirrored punctuation, superscript and Georgian variations. A two-face collection retained each face’s name and advance. A separate clean build and Node library import passed. Strict types, both production builds, 1,186 pure tests and two real Auth tests passed. Local Graphify has 30,599 nodes and 101,104 edges. Binary behaviour and dynamic module loading are covered by execution.

Removing all font-face declarations in the browser did not change the image-picker discrepancy. Chromium with overlay scrollbars sized the same native select at 67 px; with classic scrollbars it was 71 px. Pinning the classic setting in Playwright restored the original screenshots with zero tolerance changes. Picker, pattern, packaged font and shaping checks passed. The complete production Chromium suite at f6f595c passed 206/206 in 382.9 seconds, one worker, zero skips, retries or flakes.

### Grapheme navigation and wrap opportunities

TextGraphemes indexes UTF-16 and scalar boundaries for a layout. Plain ASCII needs no extra table. Arrow keys move by grapheme. Backspace peels a trailing mark from an alphabetic base while keeping flags, keycaps and joined emoji atomic. Nine native reference strings supplied backward, forward and Backspace results at every scalar position, including one past the end. Node and Chromium matched. The pure suite also exercised a 240,000-character ASCII layer.

The native CJK opening and closing punctuation, small-kana and figure-space rules map to text-wrap-boundaries. A 45-by-45 matrix matched all 2,025 native pairs for wrap and justification opportunities, trailing spaces and safe emergency breaks. Thai, Lao, Khmer and Burmese dictionary or LSTM word boundaries and actual line placement remain open. Strict types, both production builds, 1,198 pure tests and two local Auth tests passed. The focused Chromium comparison passed. The last full browser suite is the 206/206 run at f6f595c.

The local graph contains 30,621 nodes and 101,152 edges. Verified native grapheme_step and break_between alongside TextGraphemes and breakBetween. The native fixtures, bundled font digests, glyph tests and focused browser runs cover behaviour beyond the static graph.

### Loaded font selection and variable instances

The Rust text crate at a4251ca8 ran against the same five bundled font files with system font discovery disabled. FontLibrary.find matched ten family/style requests, including legacy names, weight and slope matching, and unknown families. All nine named Georgian instances and six style/axis combinations matched Face::axis_values. Explicit coordinates take precedence and clamp to the font’s limits. Bounded sfnt table reads support both single fonts and collections.

FontLibrary.segments selects one face per grapheme within a style span, preserves scalar offsets, and splits at bidi level changes, newlines and line separators. Six mixed-script strings matched the face, glyph ID and source cluster from native layout in Node and Chromium. Separate controlled coverage tests exercise colour emoji preference, variation selectors, clipped spans and combining marks. Both builds, strict types, 1,209 pure tests, two real Auth tests and the focused browser consumer passed. The last complete Chromium run was 206/206 at f6f595c.

Local Graphify rebuilt the React index over the fff934d working tree with this checkpoint’s changes and merged the pinned Rust graph. The combined graph has 30,658 nodes and 101,265 edges, including FontLibrary, fontSegments and pick_cluster_face. The extractor reports no symbols for the package entry and the browser fixture. The package consumer test exercises those paths.

At 6a5abd2 the subsequent full local production Chromium run passed 207/207 in 383.7 seconds with one worker, zero skips, failures, flakes or retries.

### Styled glyph positions

Read-only native Figcraft layout at a4251ca8 supplied fifteen positioned, single-line cases using the bundled faces, including mixed-script fallback, fractional width and weight, kerning, negative and positive tracking, size clamps, upper-case expansion, final sigma across style boundaries, title case, small caps, and native and synthesised super/subscripts. Node and Chromium matched every face, glyph ID, source range, x and y position, size, advance and final line width. These comparisons use the native line baseline to isolate glyph positioning. An independent level-input test covered RTL mirroring and zero-advance hard breaks.

The styledGlyphs iterator consumes native text data, loaded fonts and scalar bidi levels. It retains tracking separately so a line builder can omit trailing spacing. Advances and kerning deltas round separately to the native 1,024-step em grid. The scalar mapping keeps case expansions together and OS/2 metrics set synthesised script size and vertical shift. The updated package passed strict types, both production builds, 1,225 pure tests, two local Auth tests and three focused Chromium workflows including the signed-in editor’s lazy font loads. The most recent full browser pass is 207/207 at 6a5abd2.

Local Graphify refreshed the React index from 6a5abd2 with the styled-glyph changes and merged the pinned Rust graph. The 30,668-node, 101,318-edge graph includes native shape_segment and React styledSegment and styledGlyphs. Runtime fixtures cover the package exports and the generated browser consumer.

Next port paragraph bidi resolution, visual item and justification-gap order, then line wrapping and baseline calculation. Local font discovery, glyph painting and editable browser text layers remain open.

### Bidirectional paragraphs and visual order

The native text crate resolves Unicode 16 levels per scalar and retains the paragraph direction at the caret after the final character. Figcraft’s RTL candidate fast path, per-paragraph overrides and raw embedding levels are observable before line reordering. styledGlyphs now resolves these levels automatically and preserves supplied levels for callers that already shaped the paragraph.

The independent TypeScript implementation handles embeddings, isolates, overrides, numbers, marks, bracket pairs, visual order and justification-gap order. The two generated tables derive from the pinned Unicode 16.0.0 DerivedBidiClass.txt and BidiBrackets.txt. An exhaustive comparison uncovered 3,970 reserved or unassigned characters whose native class differed from the published block defaults. The corrected tables matched unicode-bidi 0.3.18 on all 1,112,064 scalar values. The pure regression checks the native table digest.

Running the pinned Figcraft functions over the Unicode BidiCharacterTest and BidiTest inputs produced the same raw levels, paragraph directions, item order and gap order in 91,707 character cases and 770,241 class/direction cases. Another 12,000 seeded mixed-script, control and forced-paragraph cases matched. These are comparisons with Figcraft before line-end resets. Nineteen pinned fixtures also matched Chromium, including maximum embedding depth, unclosed isolates, astral letters and trailing newlines. Strict types, both builds, 1,246 pure tests, two local Auth tests and three focused Chromium workflows passed. The previous full production pass was 207/207 at 6a5abd2.

Combined local Graphify at Rust a4251ca8 and React 44cb676 plus these edits has 30,729 nodes and 101,434 edges. Verified textBidi, resolveParagraph, visual_order and visual_gaps. Next connect line breaking, metrics and visual glyph placement. Editable text nodes and publication remain open.

At bf84fe5 the full local production Chromium suite passed 208/208 in 377.1 seconds with one worker and zero failures, skips, retries or flakes.

### Line flow, list markers and truncation

TextLineBreaker implements hard and soft breaks, greedy wrapping, whole-grapheme emergency breaks, saved starts with font-mismatch fallback, Balance and Pretty. TextListLayout handles numbering restarts and decimal, alphabetic and Roman labels, bullet glyphs, native gutters, paragraph indents and hanging lists. The library’s layoutTextFlow positions the visual runs, gaps and list markers using the line’s primary font metrics, cap-height trimming and horizontal alignment. Trailing spaces keep their source positions while visible width excludes them. Height and line limits place the native ellipsis and extend the shown source range to include characters drawn from the next line. The low-level API accepts scalar word boundaries for scripts that require a word model.

Read-only native layout at a4251ca8 supplied 33 complete flow fixtures, including empty lines, mixed scripts, soft breaks, right-to-left lists, variable fonts, hanging punctuation, justification, saved breaks, wrap styles and truncation. Node and the Chromium package consumer matched every line, glyph position, source range, glyph ID, face, size, direction, advance, total bounds and truncation flag. A separate generated comparison matched every line and glyph across 1,000 mixed-script and list documents and a further 1,000 random height and line limits. Strict types, both production builds, 1,279 pure tests, two local Auth tests and three focused Chromium workflows passed.

Local Graphify refreshed the React source and tests over bf84fe5 and merged the pinned Rust index. The combined graph has 30,769 nodes and 101,615 edges. Verified layoutTextFlow, TextLineBreaker, break_lines and truncate_layout. Glyph outline painting, decorations, text paths, editor integration and final publication remain open.

Next connect the four complex-script word models. The pinned native browser build uses ICU4X 2.4.0 LSTM line segmentation for Thai, Lao, Khmer and Burmese. The desktop build uses the dictionary. The official all-feature ICU npm WASM is about 19 MB. An external experiment removing unused exports and optimising that existing binary still produced 16,003,334 bytes. Build or extract just the required independent ICU data and verify it against the browser-selected model. Then connect glyph ink, decorations and text layers.

### Complex-script word boundaries

The browser build of upstream Figcraft uses ICU4X 2.4.0 LSTM models for Thai, Lao, Khmer and Burmese. The desktop build uses dictionaries that split some compounds differently. The independent package ships the upstream ICU4X C API and model data in a 419,318-byte lazy WebAssembly asset. scripts/rebuild-word-segmenter.sh pins the source, compiler and output digest. Ordinary builds use the precompiled asset. The TypeScript wrapper marks interior scalar boundaries within the same script ranges as Figcraft, filters unsafe breaks and shares one module instance. A failed request can be retried.

Verified against the actual wasm32 builds of Figcraft’s word_breaks and layout at a4251ca8. All 6,000 generated word-boundary arrays matched. Twenty-one fixtures matched both word flags and wrapped line ranges, widths, baselines and height in Node and Chromium. Chromium verified zero word-model requests for ordinary text, recovery from HTTP 503 and one shared successful load for concurrent callers. Strict types, package and Next.js production builds, 1,300 pure tests, both real local Auth tests and three focused Chromium workflows passed. Local Graphify merged the React edits over 728cc96 with the pinned upstream graph, producing 30,792 nodes and 101,662 edges.

In a separate stress test using Inter Regular, 981 of 1,000 mixed-script layouts matched. The 19 mismatches reduce to glyph-cluster or advance differences for mixed scripts and uncovered marks. All 19 had the correct word boundaries. Resolve the shaping configuration against these reproductions before glyph painting and editable text layers.

The complete local production Chromium run passed 208/208 in 383.8 seconds with one worker and zero failures, skips or retries.

### Shaping fallback and Unicode tables

The 19 failing layouts at 6770c2c reduced to missing-glyph mark positioning, clusters at unassigned code points, and Thai decomposition in mixed-script text. The distributed minimal HarfBuzz build disables legacy fallback shaping and simplifies Unicode properties for unassigned characters. HarfRust 0.13.3 targets HarfBuzz 14.3.1 with Unicode 17. The package now uses that public HarfBuzz release with the harfbuzzjs 1.6.0 bindings, full unassigned properties and legacy shaping enabled. AAT and bitmap font support are compiled in. The reusable engine still owns case mapping, styled runs, logical layout and browser word segmentation.

The pinned Emscripten rebuild produced byte-identical JavaScript and Wasm on two runs. The shaper is 534,101 bytes and shares its Wasm file between the browser and Node. Package builds clean their generated directory before emitting declarations and runtime assets. An npm pack dry run found one shaper and one word model.

The original 1,000 layout cases now match upstream wasm32 Figcraft. A second seed added 10,000 exact full layout comparisons. Together the two runs compared 16,000 word-boundary masks and 11,000 layouts. Fourteen reduced regressions compare wrapped geometry, and eight unwrapped native fixtures compare glyph IDs, positions and ranges for Hebrew, Arabic, Thai, Lao, Khmer, Myanmar and mixed marks. Node and the generated Chromium consumer passed all 35 word fixtures and 41 full glyph-flow fixtures. Strict types, both production builds, 1,322 pure tests, two local Auth tests and three focused Chromium workflows passed. The last complete Chromium run was 208/208 at 6770c2c.

Local Graphify merged the React changes over 6770c2c with Rust a4251ca8, yielding 31,155 nodes and 102,146 edges. The next step is glyph outlines and layout-space ink, followed by decorations, text paths and editable browser text nodes.

At 0015fe4 the full local production Chromium suite passed 208/208 in 381.3 seconds with one worker and zero failures, skips or retries.

### Glyph outline reference

Upstream Face::outline_at selects skrifa’s default FreeType path style with unscaled, unhinted font coordinates. Glyph::layer_path flips the font-space Y axis through the outline pen and applies glyph size, baseline position and path warp. HarfBuzz’s floating variation deltas differ by up to 0.987 font units from these outlines. The signed rounding occurs before implied quadratic midpoints. Whole-font comparisons remove geometrically redundant closing lines and zero-length lines.

A local FreeType 2.15.0 comparison loaded the original font bytes with FT_LOAD_NO_SCALE, FT_LOAD_NO_HINTING and FT_LOAD_NO_BITMAP. Normalising variable axes to the native F2Dot14 precision before loading the glyph resolved 23 outline differences at an intermediate Georgian width and weight. All 13,928 reference glyph outlines across the five bundled fonts and four Georgian axis configurations matched, including controls, points and winding. All 11,080 additional glyph outlines at 20 seeded fractional axis configurations matched. These are reference experiments. Browser glyph painting remains open.

Next implement the unhinted TrueType outline reader using the independent FreeType library, reuse the loaded face bytes, preserve quadratic midpoints in the TypeScript path adapter and compare actual Node and Chromium drawing with the reference. Follow with CFF, coloured glyphs, decorations, warped paths and text editing.

### Browser glyph outlines

ShapingFace.outline reads unhinted TrueType, CFF and CFF2 contours in downward-Y font units. glyphPath places these outlines at the glyph’s baseline and scale, applies its optional warp, and accepts a separate colour-layer glyph ID. The binding keeps a FreeType face on the HarfBuzz face, sharing the original font buffer and its lifetime. Normalised variation settings select the same instance used by the shaper. The TypeScript path adapter elevates quadratic curves to cubics and the per-face cache bounds both entries and retained commands. The single lazy shaper asset now occupies 869,432 bytes, about 372 kB with gzip.

Independent comparison at a4251ca8 matched all 25,012 sets of outline commands, including four CFF/CFF2 instances and 25,008 TrueType instances. Seventeen fixtures also compare the fully placed glyph path with native outlines in Chromium. Filled masks under shear and rotation agreed within the 1.5% alpha-error gate, with no fully opaque pixel disappearing or appearing in the other mask. The synthetic two-face collection exercises collection indices, fractional CFF control points and a variable CFF2 blend. All 1,340 pure tests, both local Auth checks, strict types, both production builds and three focused Chromium workflows passed. Local Graphify merged 31,199 nodes and 102,231 edges. Next integrate native decoration geometry, measured text paths and editing into the renderer and document model.

### Text on a path

The browser follows the first measurable subpath at the glyph advance centre. Closed and almost-closed paths wrap, open paths collapse out-of-range glyphs, and flipped paths reverse the tangent. Multiline offsets use the first baseline. Invalid and over-budget paths clear the glyphs and retain the line geometry. Quadratic SVG commands survive until the length sampler, which follows Kurbo’s curvature-based subdivision. The shaper and FreeType assets also reproduced byte-for-byte from the pinned build.

At a4251ca8, 24 fixed native layouts matched every affine coefficient and layout-point probe within 0.00000001. Another 2,400 seeded comparisons matched within 0.00001, including rotated elliptical arcs. The largest observed difference was 0.00000914 in a rotated-arc case. Chromium passed the public package’s glyph placement fixtures and variable-width stroke rendering. The updated geometry ceiling accepts a 1e9-wide tapered line and falls back to uniform strokes above 1.5e9. Both production builds, strict types, 1,365 pure tests and two local Auth checks passed. The combined local graph has 31,215 nodes and 102,304 edges. Text painting, decorations and editing remain in progress.

The complete local production Chromium suite passed all 208 workflows in 382.8 seconds at the curved-text checkpoint, with one worker and zero failures, skips or retries.

### Caret geometry

The public package now resolves scalar-index caret positions, visual left/right movement, pointer hits on straight and curved text, and selection rectangles. The same methods cover ligatures, overlapping clusters, hard breaks, wrapped lines, bidirectional runs, a trailing empty paragraph, truncated lines and glyphs beyond an open path. Bidirectional movement builds the current line’s caret positions in a single glyph pass.

The independent a4251ca8 reference matched 78 fixed and 2,100 seeded layouts, including 49,183 caret positions and both directions of movement at each position, 15,246 pointer hits and 13,068 selection ranges. Twenty-nine fixtures replay through Node and the browser package in local production Chromium. Both production builds, strict types, 1,394 pure tests and two local Auth checks passed. Local Graphify covers both checkouts with 31,234 nodes and 102,368 edges. Next implement decorations, paint bounds and document/editor text integration.

### Decoration paths and paint bounds

The browser lays out solid, dotted and wavy underlines and strikethroughs. Font metrics, style-run boundaries, size and offset overrides, decoration colour, list markers and truncation follow the native rules. Skip-ink measures quadratic and cubic outline segments crossing the decoration’s band. Text on a path drops its decorations. textToPath combines outline and decoration contours for vector commands, and textInkBounds includes the transformed native advance boxes and decorated extents.

At a4251ca8, 40 fixed and 1,250 seeded layouts matched placement, colour, ink bounds and 146,114 outline commands. The largest coordinate difference was below 0.000000000003. The generated browser package replayed 22 fixtures with identical alpha masks in Chromium. Both production builds, strict types, 1,418 pure tests and both local Auth checks passed. The current local graph contains 31,249 nodes and 102,449 edges. Colour glyphs, text layer painting, editing and persistence remain open.

### Layered colour glyphs

ShapingFace.colourLayers reads native COLR v0 records and CPAL palette zero. Layer order, straight RGBA, foreground fallback, the 256-layer ceiling and per-face cache are covered. The reader accesses the immutable font buffer held by HarfBuzz and resolves each table against current WASM memory. A caller changing its source array after loading the font cannot change the colours. The ordinary build adds no new WebAssembly binary. The synthetic test face includes overlapping triangle and square contours, a default foreground layer, 280 repeated layers and two bitmap strikes.

The independent a4251ca8 reader and browser agree on the translucent triangle, opaque square and fallback colour. Chromium painted both coloured layers in native order. A full run at the decoration checkpoint exposed a recovery test race after reloading. The gradient keyboard-save check now waits for its recovered layer to appear. The targeted colour and recovery tests both passed three consecutive local production runs. Both production builds, strict types, 1,420 pure tests and two Auth tests passed. The combined graph has 31,262 nodes and 102,477 edges. The next step is colour bitmap strikes, followed by text layer painting and editor integration.

The complete production Chromium suite at c05226b passed 208/208 in 390.9 seconds with one worker and zero failures, skips or retries.

### Bitmap colour glyphs

Glyph colour now resolves COLR layers before sbix, CBDT and EBDT strikes. Strike selection chooses the nearest available size in native order. The reader handles five bitmap index formats, PNG image formats 17–19, raw premultiplied BGRA, missing glyphs and alpha-only masks. Bitmap placement applies native bearings and the glyph’s warp. Size requests clamp to 512 device pixels per em, and per-face raster storage is bounded at 32 MiB and 8,192 entries. The native enlargement samples a half-offset in normalised destination coordinates. Matching that order removed eight initial differences.

The PNG decoder reads the existing Wasm font buffer, limits each source dimension to 1,024 pixels and returns straight RGBA for explicit premultiplication. The [Wuffs decoder](https://github.com/google/wuffs/blob/7f70dda95c77b10c087c0908790837b5e9c15713/doc/std/image-decoders.md) is pinned and licensed in the package. The lazy shaper is 938,661 bytes, 415,347 bytes with default gzip. The rebuild reproduced all six distributed assets byte-for-byte.

At a4251ca8 all 1,056 independently generated raster requests agreed on dimensions, bearings, presence and every premultiplied byte. Those requests include 462 each against local Apple Color Emoji and the Noto Color Emoji CBDT font at 99701e07, and 132 redistributable synthetic fixtures. Chromium replayed the 132 fixtures through the installed package. They cover all PNG channel families and legal bit depths, transparency, all five filters, Adam7, unscaled, enlarged and reduced bitmaps. The real emoji fonts are reference inputs only. Strict types, both production builds, 1,554 pure tests and both Auth checks passed. One concurrent test run timed out on the existing clipboard archive test during the native rebuild. The focused clipboard suite and clean full rerun passed. The local graph contains 31,286 nodes and 102,540 edges. Next integrate the text layout, style runs, colour ink, decoration paths, vertical alignment and strokes into document text layers and the canvas.

### Native text layers and file interchange

The full Chromium suite passed 208/208 at the bitmap checkpoint `59d5d46` in 380.4 seconds, with one worker and zero retries, skips or failures.

The document adapter now reads and writes the flattened native text node. It preserves the base style, runs, paragraph records, path, breaks and exact unsigned 64-bit layout key. Text creation and character replacement fit the bundled fonts, keep edits undoable and use Unicode scalar ranges. The async command entry loads the font catalogue and, when needed, ICU before applying the edit. The synchronous entry supports callers which have already prepared those dependencies. The catalogue and shaping binaries remain on demand.

The desktop-free Rust reference created [the native text fixture](../../tests/fixtures/native-text.json) at a4251ca8. It measured the plain two-line text at 90 × 30. The production React host opened the styled fixture, painted both run colours, downloaded it and recovered it after reload. The reverse check opened the edited React output in figcraft-doc and verified its characters, override, 64-bit break key and 91 × 116 native dimensions. The [command and archive tests](../../tests/parity/text-node.test.ts) also exercise both creation aliases, selection and undo/redo.

The local combined graph contains 31,333 nodes and 102,735 edges. It resolves React `autoSizeText` and `paintText` and upstream `auto_size`. Strict library, host and test types passed, both production builds passed, and the suite passed 1,556 pure checks plus two local Auth checks.

Next complete the browser text tool, inline editing and IME, rich-text commands and inspector. Additional checks cover text strokes and effects by style, transformed bounds, font registration, text-path resizing, masks and vector operations. The rich-text slice remains open.

The first full browser run after integrating document text exposed a consumer packaging regression. The standalone canvas fixtures compile a single immediately invoked script, which cannot contain top-level await. The shaper now initialises through a lazy, retryable promise when a font is read. Its JavaScript and declarations reproduce exactly from the pinned package and build script. The first affected standalone paint, geometry and frame-budget tests pass on the corrected build.

### Canvas creation, editing and input methods

The corrected standalone and Next.js builds passed 209/209 production Chromium cases in 412.5 seconds with one worker, zero retries and zero skips.

The Text tool and T shortcut create native layers at the rounded click offset. Dragging at least three screen pixels creates a fixed box. Parent transforms and readable fill selection follow the native frame and page rules. Double-clicking enters an existing layer and selects its contents. While editing, a double-click selects the word, script, whitespace or punctuation at the pointer. A comparison against the pinned Rust word-selection logic matched 69,156 scalar positions across 1,355 strings.

Typing and range replacement update the canvas preview without publishing a React document snapshot per keystroke. Authored names survive edits. Auto-named layers follow their first line. A session commits one undo step. Discarding a blank new layer preserves redo. The browser text control handles ordinary typing, clipboard and composition. The canvas paints the temporary composition in its own document view and underlines its range. CDP drove an actual Chromium composition, checked the temporary pixels, committed different text, downloaded the result and undid the session.

The new focused workflows passed in the authenticated production host. Strict types, both production builds, 1,559 pure checks and the two local Auth checks passed. Local Graphify resolves the React editor and upstream word-selection symbols in the combined graph. The package dry run included both runtime loaders, all five bundled fonts and the shaping binary.

The complete canvas editing build passed 211/211 production Chromium workflows in 416.6 seconds with one worker and zero failures, skips or retries. Fourteen reference screenshots changed to show the new Text tool. Decoded pixel comparisons confined every accepted difference to the toolbar rectangle (x 86–914, y 727–788 in 1,000 × 804 images).

Continue with the remaining upstream editing commands, native keyboard and list behaviour, input-method edge cases and typography inspector. Full rich-text parity, cross-feature verification and final publication remain open.

### Text property inspection

Native `node.get` text inspection now returns base typography, spacing labels, truncation, path, decoration settings, list and direction fields, OpenType axis values, native styled runs and linked style ranges. Field filters keep expensive array construction off unrelated queries. Outline output takes at most 120 Unicode scalars before adding an ellipsis.

The pinned Rust `automation::inspect::text_props` supplied 480 full and outline results across 240 distinct inputs. Each returned property matched the React command data. Four representative records run through the normal `node.get` entry in the [inspection tests](../../tests/parity/text-inspection.test.ts). Strict types and 1,563 pure tests passed. The combined local graph contains 31,372 nodes and 103,010 edges. Typography editing and the inspector controls remain open.

### Typography commands and inspector

The signed-in inspector applies font family, named style, size, line height, tracking, decoration, case, alignment, resizing and paragraph options to selected text layers. A live canvas selection supplies Unicode scalar offsets, including astral characters. Changing a field during editing preserves the selection and the session’s single undo step. Mixed selections display the differing fields as mixed. The five bundled faces supply the font menus and native nearest-style warnings.

`node.set`, `text.style` and `text.set` share the native style and paragraph representation. The command path handles whole-layer and partial ranges, paragraph lists and direction, decoration settings, OpenType toggles and variation axes. A text layer’s native child sizing survives file open, inspection, editing and save. Changing an auto-width, right-aligned layer preserves its right edge under the native conditions.

A reference executable linked the pinned upstream **figcraft-engine** and registered the same packaged fonts. Across 401 generated command sequences, React matched the native command result or refusal, warnings, inspected node, dimensions and saved text fields. A native session also opened the entire React-edited layer and matched the Rust-edited layer after deserialisation. Representative command results and the original Rust document run in the [regression suite](../../tests/parity/text-node.test.ts).

An additional 247 `text.style` and `text.set` cases matched the same Rust session, covering parameter refusal, typed lengths, coercion, aliases and range limits. The complete production suite passed 212/212 in 422.4 seconds with one Chromium worker and zero retries. After tightening invalid parameter and auto-length handling, the rebuilt host passed all four signed-in text workflows, including native file recovery, IME and selected-range formatting. Strict types, 1,574 pure tests and two actual local Auth tests passed. Implementation checkpoint `ff6bc4e`. The combined local Graphify index contains 31,414 nodes and 103,173 edges, including both native and React typography owners.

### Formatting commands, lists and links

Implementation `c2c5cd0` applies the native text formatting commands to Unicode scalar selections, whole layers and text descendants of selected containers. Repeated or overlapping layer targets follow native behaviour. The canvas handles bold, italic, underline, alignment, spacing and weight shortcuts, list markers, indentation and leaving an empty list. Creating a link retains the selected range. Opening it checks the schemes accepted by the native editor.

A separately built Rust session matched 532 formatting sequences, 468 list input cases, 160 grouped or overlapping target cases and 600 link cases. All 1,760 comparisons matched. The signed-in browser exercised the shortcuts, saved the edited ranges, tested undo, and observed link activation. Both production builds, strict types, 1,589 pure tests and two local Auth checks passed. The full production suite passed 214/214 in 419.7 seconds with one worker and zero retries. Local Graphify covered the native and browser command owners in a combined 31,459-node graph. [Regression tests](../../tests/parity/text-format-commands.test.ts).

### Attaching and resizing text on paths

Implementation `8004494` adds the native attach, offset, flip and detach commands and inspector controls. Attaching consumes the source shape, places the text in its slot and preserves applicable fills, effects, transform and box. Undo restores the source. Resize and scale transform the saved path data. Command, nudge and pointer resizing honour text sizing and truncation, and uniform scaling adjusts text, runs and paragraph measurements before refitting the box.

Across 55 Rust command sequences covering eleven source shapes, all command results, SVG verbs and non-coordinate properties matched. SVG strings matched exactly in 39 cases. The other sixteen differed by at most 2.85 × 10⁻¹⁴ document units per coordinate. All 176 further resize, scale and nudge sequences matched exactly, including plain and curved text, all four sizing modes and right alignment. Twenty-seven retained regression cases pass, including native file round-trips, invalid ancestry, history and pointer resize. The authenticated path workflow attached text to a curved vector, edited its offset and side, saved the result, detached and undid. Strict types, both production builds, 1,616 pure checks and two local Auth tests passed. Local Graphify resolves both implementations in 31,473 nodes and 103,528 edges. [Path command tests](../../tests/parity/text-path-commands.test.ts).

The full production build at `8004494` passed all 215 Chromium workflows in 422.4 seconds, one worker and zero failures, skips or retries.
