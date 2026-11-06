# Changelog

All notable changes to the React port and its upstream compatibility baseline are recorded here.

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
