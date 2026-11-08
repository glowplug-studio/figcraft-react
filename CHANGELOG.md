# Changelog

All notable changes to the React port and its upstream compatibility baseline are recorded here.

## [0.42.0] - 2026-11-09

- Added Shape Builder for overlapping fills and stroke outlines, including merge and remove gestures, regional paints and native recovery.

## [0.41.0] - 2026-11-09

- Added Simplify vector for open trails and closed painted regions, with source winding and paint-frame preservation.

## [0.40.0] - 2026-11-09

- Added signed Offset path editing for native shapes and vector regions, preserving holes and paint frames.

## [0.39.0] - 2026-11-09

- Added Outline stroke for supported layers, including retained fills, profile and brush geometry, native save and undo.

## [0.38.0] - 2026-11-09

- Added live Union, Subtract, Intersect and Exclude groups with editable operands, native file support and silhouette flattening.

## [0.37.0] - 2026-11-09

- Added vector.fillRule and vector.reverseLoop for selected areas, holes and shared short-loop boundaries.

## [0.36.0] - 2026-11-09

- Use Lasso (Q) to select points across edited vectors, Cut (X) to open paths or separate crossed parts into layers, and Eraser (Shift+E) to remove portions of paths with a circular brush.

## [0.35.0] - 2026-11-09

- Edit solid fills on selected vector regions. The inspector shows shared or mixed fills. Add, remove, reorder, copy and paste paints while preserving inherited fills on untouched regions.

## [0.34.0] - 2026-11-09

- Select and drag painted vector regions with the Move tool. Shift adds or removes a region. Hatching follows selected regions and the region under the pointer.

## [0.33.0] - 2026-11-09

- Fill or unfill closed vector faces with the Paint bucket in vector edit mode. B or Shift+B selects the tool. Drag across faces to apply the same action in one undo step.

## [0.32.0] - 2026-11-07

- Apply corner smoothing to closed vectors while preserving each point's radius, region winding and authored geometry in saved files.

## [0.31.0] - 2026-11-07

- Edit variable-width strokes on the canvas with Shift+W. Add and slide width points, adjust either side with Alt, or enter precise widths in the inspector.

## [0.30.0] - 2026-11-07

- Added Join selection, Smooth join selection and the explicit Connect points command. Joining within a vector pairs selected points, while layer joins close an open vector or combine selected layers.
- Reconnecting a broken region through its endpoints preserves the winding of its holes and the region's paints. Pen and Join share this behaviour.

## [0.29.0] - 2026-11-07

- Added the native `node.reorder` command. The layer panel uses it to change sibling order while preserving local transforms and selection.
- Page and layer ordering reject invalid indices. Vector creation rejects malformed point pairs. Stroke-cap errors list accepted values. Frame-relative lookup terminates on restored group cycles.

## [0.28.2] - 2026-11-07

- When drawing, moving or resizing a shape, a fractional layer target takes precedence over the pixel grid on the snapped axis. Free axes retain the existing pixel preference. Matches upstream `39c58338`; the global baseline is unchanged.

## [0.28.1] - 2026-11-07

- Updated Pen Undo/Redo to match upstream `7522c39b`: remove or restore individual anchors while drawing, including their handles. Completed paths still take one document undo.
- Keyboard and toolbar controls share the command path; history availability changes do not rerender the root editor. The global parity baseline remains unchanged.

## [0.28.0] - 2026-11-07

The global upstream baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`. Pencil was checked against `09e04e71765517975950403eec4cb6fbe8955359`.

- Added Pencil freehand drawing with fitted open vectors, pressure-sensitive widths, brush preferences, frame-local coordinates and one undo per stroke.
- Added captured-pointer previews, cancellation, Shift+P, native file/recovery coverage, and browser measurements for continuous drawing and long-stroke completion.
- Vector width-point editing, regions, booleans and the remaining product roadmap are outstanding. Full-parity publication remains gated.

## [0.27.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added Pen creation with parent-local cubic geometry, smooth handles, closure, interior joins and selected endpoint continuation.
- Added edit-mode Pen commands, branching/splitting, cached snapping, native Escape/Enter/double-click transitions and separate path/click undo semantics.
- Added Canvas overlays and accessible Pen controls, native download/recovery coverage and bounded 10,000-node hover/draw/edit performance fixtures.
- Pencil, region/width tools, booleans, remaining appearance/text/layout and the complete backend/product roadmap remain required. Publication is still gated on full parity.

## [0.26.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added active-vector point bounds, dimensions, resize, rotation and page-matrix commands, including edit-mode flip/fixed rotation routing.
- Added shared multi-layer point boxes, captured scale/rotate/interior gestures, live modifiers, cancellation and one-step undo.
- Added bounded point/segment-midpoint snapping, object/pixel switches and markers, with indexed lookups preserving native candidate ties.
- Pen/Pencil, region tools, guides/grids, persisted preferences, remaining vector tools and the complete product roadmap remain required.

## [0.25.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added multi-layer vector point/segment/handle authoring, native command contracts, shape conversion, refitting and atomic history.
- Added point and handle hit testing, captured drag previews, marquee selection, midpoint/Alt insertion, Bend, smoothing, deletion/healing and merge-on-drop.
- Added point position/radius/mirroring/cap/join controls, edit tools, keyboard entry/exit and native file/recovery integration.
- Point transform boxes/snapping, Pen/Pencil, region tools, width gestures, booleans and the remaining product roadmap remain required.

## [0.24.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added independent vector networks, native SVG/point creation, atomic path replacement, network resizing and native file/recovery support.
- Added rounded vector fills, per-region solid paints, winding rules, open/closed strokes, point caps/joins and native profile/brush precedence.
- Added Flatten and Reverse path direction, source paint-frame preservation, keyboard actions and existing inspector integration.
- Point/handle editing, Pen/Pencil, booleans, outlines, other paint families and the remaining product/backend roadmap remain required.

## [0.23.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added eight procedural stretch/scatter brushes with native seeded jitter, spacing, width-profile scaling and conservative rendered bounds.
- Added brush presets and scatter fields, native command/property/file contracts, conditional black paint and atomic history.
- Pencil pressure, vector authoring and outline/export operations remain required dependent work; this release does not claim their completion.

## [0.22.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added variable-width stroke profiles, six native presets, asymmetric sides, flip and mixed-selection controls.
- Added bounded independent path measurement and variable outlines with joins, caps, fitted dashes, closed alignment and native arrow winding.
- Preserved profile commands, atomic history, file/recovery round trips, dimensionless scaling and widest-side hit/culling bounds.
- Vector width-point gestures, brushes, general vector editing and the remaining product/backend families remain required.

## [0.21.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added per-side Rectangle/Frame strokes, sharp and rounded borders, elliptical inner corners, smoothing and native alignment rules.
- Added individual-stroke presets and fields, native side-weight commands, file/recovery support, scaling and atomic history.
- Replaced antialiased clipping seams with bounded independent convex boundary clipping for fitted/smoothed borders; rendering remains outside React.
- Brushes, variable width, vector editing, other paints and the remaining product/backend families remain required.

## [0.20.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added Line/Arrow creation, endpoint editing, native save/recovery, L/Shift+L tools and one-step history.
- Added uniform solid stroke stacks, alignment, joins, eight endpoint caps, fitted dashes and native paint-list commands with mixed-selection controls.
- Extended Canvas rendering, hit testing, scaling, Frame stroke ordering and opacity bounds. Stroke raster reuse is bounded; parent-local group bounds survive pan/zoom without descendant recomputation.
- Per-side strokes, brushes, variable width, vector editing and the remaining product/backend families remain required.

## [0.19.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added Polygon and Star leaves, rounded/smoothed geometry, native count/ratio properties and archive/recovery support.
- Added shape creation tools, mixed point controls, uniform corner smoothing and on-canvas radius/ratio gestures with one-step history.
- Extended shared drawing, hierarchy, selection and transformations to both kinds; mobile toolbars wrap without obscuring zoom controls.
- Documented separate hosted default-branch and local working-tree Graphify indexes. Vector editing, strokes and remaining product families are still required.

## [0.18.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added Ellipse leaves, native arc/ring paths, signed winding and hole hit-testing, command properties and native file/recovery support.
- Added Move-tool sweep/start/ratio handles, signed continuity, Shift snapping, gap complement, one-gesture history and mixed-selection Arc controls.
- Added Ellipse/O creation and shared captured drawing with Frame nesting, endpoint snapping, Shift circles and Alt centring; previews remain outside root React updates.
- Corrected supported creation parameters to native lenient numeric/name/selection parsing. Remaining vector kinds, stroke rendering and complete UI/preferences remain required roadmap work.

## [0.17.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added rounded/smoothed Rectangle and Frame paths, native corner properties and persistent independent radii.
- Added on-canvas radius handles, Alt individual edits, one-gesture history, mixed-selection controls and the iOS smoothing preset.
- Rounded Frame children clip visually while native rectangular Frame hit behaviour remains intact; Scale multiplies radii and ordinary resize retains them.
- Added source-derived geometry, native file, authenticated browser and large-document interaction checks. Further shape kinds and complete UI remain required roadmap work.

## [0.16.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added oriented pointer resize/rotation handles, snapping, crossed-side flips, child constraint preservation and single-gesture history.
- Added Scale tool K, signed uniform subtree scaling, nine session anchors, factor/dimension controls and live dimension scrubs.
- Corrected inherited canvas overlay colours to the source-evidenced light/dark contrasting greens.
- Added constrain-proportions properties, linked numeric edits and native round trips; handle previews remain outside root React updates.
- Other kinds, strokes/effects/text/image/layout scaling and complete UI/preferences remain required roadmap work.

## [0.15.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added canvas move/marquee selection, deferred multi-selection clicks, deep selection and group entry for supported layers.
- Added parent-space object/equal-gap/pixel snapping, guide labels, Frame drops and Alt-copy modifier transitions with repeated offsets.
- Extended engine previews to selection and cached subtree allocation without root React frame updates; commit/cancel retains native history and persistence boundaries.
- Resize/rotate/scale handles, other node kinds, auto-layout, rulers/grid/preferences and remaining workflows are required later slices.

## [0.14.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added supported layer subtree duplication, exact ID maps, top-level Frame spacing and repeated page-space offsets.
- Added Ctrl/Meta+D and layer controls with atomic allocation, selection/history lifecycle and native persistence.
- Component/instance copying, connector remapping, rename preferences and Alt-drag extend in their remaining slices.

## [0.13.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added smart-selection track spacing, visual slot insertion/swapping and pixel rounding for supported layers.
- Added engine-owned transient document interactions, single-step commit/cancellation, inspector spacing scrubs and canvas gap/reorder handles without root React frame updates.
- Auto-layout/instance restrictions and multi-file gesture isolation extend with those remaining families; general pointer transforms remain required.

## [0.12.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added transient rotation origins with canvas dragging, box snapping, double-click reset and Alt+R/Escape controls; no document/history changes while moving the origin.
- Added page-space rotations/flips and rotation-field pinning, with inspector controls, finite transactions and native persistence.
- General transform gestures, vector/text editing and unsupported kinds remain required later slices.

## [0.11.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added nine-anchor numeric resizing, uniform subtree scaling and keyboard size nudges, with atomic history and finite geometry checks.
- Added sizing controls, rotated/reflected and nested source-derived fixtures, and native/recovery browser flows.
- Scale effects on unsupported properties/kinds, layout sizing, preferences and pointer handles remain required later slices.

## [0.10.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added atomic page-space movement, parent-space keyboard nudging, six alignments, distribution, packing, tidy-up and stacking commands for supported layers.
- Added arrangement controls, source-derived nested/rotated/multi-parent fixtures and authenticated native/recovery browser checks.
- Gesture movement/resizing, snapping, nudge preferences, auto-layout flow handling and remaining arrangement/product behaviour remain required.

## [0.9.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added independent viewport state, native zoom steps/fit/anchor maths, frame/page navigation and keyboard shortcuts.
- Added wheel, Space/middle-button pan and held-Z zoom gestures with transformed rendering, selection and drawing outside root React updates.
- Added all 39 native frame presets and evidence-backed free placement, plus browser and moving-view performance fixtures.
- View preferences, grids/guides/snapping, other editing gestures and remaining product families remain required.

## [0.8.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added Frame containers with transformed clipping, solid fills, isolated opacity and frame-relative selection/creation.
- Added frame wrapping/removal, Frame/Group conversion and all horizontal/vertical constraint modes with iterative nested resize propagation.
- Added frame/constraint inspector controls and native/recovery/page subtree support, with source-derived and authenticated browser fixtures.
- Preset placement, viewport navigation, drawing/resize gestures, sections, advanced layout and remaining product families are still required.

## [0.7.0] - 2026-11-07

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added nested groups, world-preserving grouping, ungrouping and reparenting, deep deletion, group fitting and resize propagation with atomic history.
- Added nested selection, group opacity compositing, layer-tree controls and mobile layer navigation.
- Extended native files, recovery and page duplication/deletion to supported group subtrees, with explicit depth and hierarchy validation.
- Frames, sections, other node kinds and the remaining product workflows are still required.

## [0.6.0] - 2026-11-06

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added native f32 colour, CSS/hex/named and perceptual colour parsing, solid paint stacks and independent alpha metadata in native files and recovery.
- Added page backgrounds and rectangle name, visibility, locking, opacity and fill controls through existing commands and undo/redo.
- Added paint-stack compositing, transparent background clearing and visibility/lock-aware pointer selection, with retained plain/affine rendering performance checks.
- Gradients, other paint kinds, advanced blending/effects, complete colour-picker UI and the remaining product workflows are still required.

## [0.5.0] - 2026-11-06

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; full parity remains in progress.

- Added finite affine rectangle transforms, centre-preserving rotation, geometry property edits, atomic history and native/recovery round trips.
- Added basic selection commands, layer controls and inverse-transform pointer selection for supported flat rectangles.
- Added transformed Canvas 2D painting and screen-width selection outlines, retaining legacy translated-node compatibility.
- Added algebra, transformed-file, property, selection and transaction fixtures, authenticated rotation/reload checks and a 10,000-transformed-rectangle performance fixture.
- Full node properties, hierarchy, paints, gestures, viewport and remaining product workflows remain required.

## [0.4.0] - 2026-11-06

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; the full port remains in progress.

- Added page creation, navigation, renaming, deletion, duplication, ordering and listing for supported page/rectangle documents, including divider and last-ordinary-page rules.
- Added desktop and narrow-screen page controls, native/recovery page round trips and page-aware undo/redo. Navigation preserves the saved content state.
- Kept maximum u64 allocations serialisable while refusing subsequent exhausted allocations.
- Page backgrounds, guides/prototypes, full hierarchy and all remaining product families remain tracked dependencies.

## [0.3.0] - 2026-11-06

The reference baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`; the full port is in progress. The synchronised `0b97f3f1` reference changes house rules only.

- Added native version-1 page/rectangle JSON and ZIP opening and download, exact u64 identifiers, bounded decompression, CRC32 integrity and atomic failure handling.
- Added captured-revision save acknowledgement and principal-scoped IndexedDB recovery across reloads, with explicit storage failures.
- Added full-product source/command inventories and a continuing dependency roadmap. Non-rectangle document properties, resources, history and branches remain unsupported by this bounded codec and are rejected explicitly.
- Browser downloads acknowledge hand-off to the browser; the browser does not report whether the user retained the file. Recovery is local device storage, not online file persistence.

## [0.2.0] - 2026-11-06

Reference upstream remains Figcraft `8eb0b87646c5aef712326d6c431ccde5408630de`.
Support is limited to the documented local rectangle slice, not the complete upstream application.

- Added an independent TypeScript document/command engine and Canvas 2D rectangle workflow, selection, undo/redo, constrained drawing and cancellation.
- Added an embeddable React editor receiving host identity and capabilities; pointer previews remain outside React reconciliation.
- Added a Supabase-backed Next.js password-login host, validated protected routes, session refresh, callback handling and logout.
- Added paired upstream fixtures, real local Auth denial checks, browser screenshots and measured rendering/interaction checks.
- Recorded the dependency-ordered port roadmap and remaining gaps; save/load, advanced tools and collaboration remain separate slices.

## [0.1.0] - 2026-11-06

Supported upstream: Figcraft `8eb0b87646c5aef712326d6c431ccde5408630de` (2026-11-05).

- Established the provider-neutral React library foundation and Next.js preview host.
- Added the upstream Figcraft repository as a pinned Git submodule.
- Added Supabase client-adapter scaffolding, local configuration and environment templates; Realtime and Auth remain planned adapter work.
- Added Playwright browser verification for the Next.js preview host.
- Added a gated Vercel deployment and GitHub demo-publication phase to the porting prompt.
- Added provider-neutral identity, ownership and document-access contracts, in-memory reference adapters and shared conformance tests.
- Added setup, planning, reporting and parity documentation structure.
