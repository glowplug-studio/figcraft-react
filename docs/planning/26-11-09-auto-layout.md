# Auto layout and constraints

## Execution checkpoint

| Field | Current value |
|---|---|
| Reference | Figcraft fork and original upstream at 3839fe4a0cb4897c1fed1fb03e0b60e191ff61cb. React 0306139 on prompt/full-figcraft-port. The global supported baseline is 8eb0b876. |
| Evidence | Local merged Graphify index has 31,869 nodes and 105,203 edges. The Rust index links the grid-placement tests to grid_place. The React index links resizeChildren to withLayerSize and hierarchy tests to setRectangleProperties. UI labels and JSON defaults were checked directly. |
| Backend | The scoped Figcraft MCP read returned zero public tables. Layout settings are part of the native document and its existing local persistence. |
| Next action | Verify mixed dimension editing and the open checks in the [property matrix](../reports/26-11-09-auto-layout-parity.html). |
| Blockers | None. |

## Implementation and verification order

1. **Document records and bounds.** Preserve container settings, child sizing, absolute position, grid anchors, spans and optional limits in native files. Share the existing text sizing representation and keep directed text edits intact. Drive bounds through node.set, node.get, transforms, scaled geometry, native recovery and undo. Setting a bound can move the opposite bound. A text maximum height clears the line limit.
2. **Flow layout.** Port child-first then ancestor reflow, coherent sizing and rotated outer bounds. Place horizontal and vertical children with padding, included strokes, fixed and automatic gaps, hug/fill/fixed sizing, wrapping, line alignment and first text baselines. Skip hidden and absolute children. Apply existing frame constraints to absolute children during resize. Preserve native nesting limits.
3. **Grid.** Match placement with full and partial anchors, overlap, spans and exhausted space. Compare fixed, hug and fractional track sizes, cell alignment and placement. Cap the grid at 1,000 tracks per axis and one million cells. The same resolved cell rectangles feed inspection and pointer handles.
4. **Command and inspector integration.** Add, remove, remove all and suggest layout. Convert a single group in place, retain mask ordering, infer gaps from flow children, and preserve the empty frame size. Exercise multi-selection, warnings and transaction rollback. Bind track editing, individual/linked padding, direction and alignment to these same operations.
5. **Canvas and keyboard.** Reorder flow children and grid cells, resize into fill, double-click to hug, and edit gap and padding handles including cancellation. Verify keyboard alternatives, narrow touch viewport, stacking order, constraints, recovery and archive download.
6. **Cross-feature and release checks.** Match pinned native documents across text reflow, nested rotations, vectors, masks and frame sizing. Measure continuous gestures and layout in large documents, including sparse grids and deeply nested frames. Run signed-in production Chromium and local Auth, publish the local HTML property matrix and record unsupported dependencies on their owning roadmap rows.

## Source mapping

| Native behaviour and source | React target and comparison |
|---|---|
| [AutoLayout, GridTrack and ChildLayout](../../original/figcraft/crates/doc/src/props.rs) and [native node records](../../original/figcraft/crates/doc/src/node.rs) | [Document](../../src/engine/document.ts), [native codec](../../src/engine/file-format.ts) and [inspection](../../src/engine/inspect.ts). Compare omitted fields, explicit nulls, unsigned spans and lossless round trips. |
| [Measurement, flow, grid and constraints](../../original/figcraft/crates/layout/src/lib.rs), [occupancy](../../original/figcraft/crates/layout/src/occupancy.rs) and [layout rules](../../original/figcraft/docs/auto-layout-parity.md) | [Layer sizing](../../src/engine/sizing.ts), [text measurement](../../src/engine/text-sizing.ts), [frame constraints](../../src/engine/constraints.ts). Compare resolved local bounds, transforms and measured text heights. |
| [Structure](../../original/figcraft/crates/engine/src/cmd/structure.rs), [properties](../../original/figcraft/crates/engine/src/cmd/props.rs) and [track edits](../../original/figcraft/crates/engine/src/cmd/layout.rs) | [Property commands](../../src/engine/properties.ts) and [hierarchy draft](../../src/engine/hierarchy.ts). Compare target selection, ordered writes, warnings, returned IDs and one-step undo. |
| [Layout panel](../../original/figcraft/crates/ui-egui/src/panels/layout_panel.rs), [drag tests](../../original/figcraft/crates/engine/src/al_drag_tests.rs) and [key tests](../../original/figcraft/crates/engine/src/al_keys_tests.rs) | Signed-in Design controls, canvas hit-testing and keyboard dispatch. Compare actual pointer movement, selection, ghosts, saved values and cancellation. |

## Frame records at 4b17c70

The 51 native layout library tests passed against the pinned source. The React container codec matched the native Rust serialiser on 1,014 generated input records, including explicit nulls, omitted properties, tracks, negative gaps and unsigned counts. The browser opened a grid frame, recovered it after reload and downloaded its native layout fields. All 1,690 pure tests, strict types and both builds passed. Frame reflow and non-default child properties remain open. The refreshed local graph contains 31,673 nodes and 104,214 edges.

## Child placement at 339a4f4

The complete Chromium run at 4b17c70 passed 235/235. The next checkpoint matched 1,013 native child-layout records and 480 generated grids with 13,039 placed children. It preserves absolute position, sizing, limits, anchors, spans and cell alignment during native interchange. A browser download after recovery preserved a spanning fill child. A separate Chromium comparison covered reversed painting of adjacent mask runs, order within a run, a hidden mask, and the topmost hit. All 1,701 pure tests, two local Auth checks and both focused browser workflows passed. Local Graphify indexed 31,701 nodes and 104,297 edges.

## Grid and flow geometry

Grid placement at 339a4f4 passed 236/236 Chromium checks. At f07279d, all 25,394 coordinates and dimensions from 420 native grids matched within 1.8e-13. All 200 nested grid/text documents matched. A 192-level fill chain settled after a track resize. The grid inspector passed signed-in edit, undo, recovery and download. Its full browser run passed 235/236 on the first attempt. One vector benchmark could not resolve the generated font asset module during a concurrent build and passed individually afterwards.

At 5a709e9, all 1,250 mixed flow, wrapped, grid and text documents matched native layout_page for child dimensions, position and automatic text resize mode. Four representative six-layer fixtures are retained in the parity suite. The 1,709 pure tests, two local Auth checks, strict types and both builds passed. Chromium verified editing a child's width, wrapping its sibling and undoing the edit. Local Graphify indexed both React 5a709e9 and the pinned native layout sources. Command-level sizing, frame authoring and canvas handles still require verification.

## Container editing at fd736f1

All 1,300 command steps in 260 native sessions matched for resulting frame properties, layer names and dimensions, success or rejection, and mixed-selection warnings. The comparison includes whole layout replacement, aliases, numeric coercion, overlapping property edits, invalid tracks, rollback and removing a layout. The signed-in inspector switches direction, preserves wrapping, edits paired and individual padding, switches canvas stacking, enters grid mode and restores vertical flow with Undo. All 1,713 pure tests, both local Auth checks, strict types, library and host builds, and two focused Chromium workflows passed. The full Chromium run on this build passed 237/237. Numeric scrubbing, child sizing and structural commands remain open.

## Child sizing at 1702886

The complete Chromium run on the fd736f1 host passed 237/237. At 1702886, 5,400 property command steps and 6,480 mixed text and geometry steps matched the pinned engine. The comparisons include explicit dimensions, bounds, fill coherence, line-limit refitting and resulting sibling transforms. Three signed-in browser checks included anchor and limit editing, absolute positioning, undo, recovery and native download. All 1,717 pure tests, two local Auth checks, strict types and both builds passed.

## Adding and removing layouts at 4c42472

All 1,680 native steps across 420 documents matched for add, remove, remove all and suggest, including selection, warning text, inferred gaps and padding, layer order, bounds and undo. The browser exercised the inspector, shortcuts and context menu. All 1,721 pure tests, two local Auth checks, strict types, both builds and four focused Chromium checks passed. Pointer reordering and canvas handles remain open.

## Keyboard reordering at 9f911fb

The 4c42472 production host passed all 239 Chromium tests. At 9f911fb, 3,840 arrow commands in 480 generated documents matched the pinned native engine for child order, parents, grid anchors, selection, geometry and transforms. Regression tests cover hidden and absolute siblings, a block at a boundary with one undo, wrapped rows, grid anchor swaps, empty cells and entry into adjacent nested frames. A signed-in Chromium check moved a selected layer left then right and verified its inspector coordinates. All 1,725 pure tests, two local Auth checks, strict types and both builds passed. The local combined index contains nudgeFlow and native wrap_slot_rows. Pointer reordering is the next checkpoint.

## Pointer reordering at 984680e

All 2,400 native pointer and undo snapshots in 480 documents matched. Each comparison checked the preview and committed parents, child order, geometry, selection, grid anchors, insertion line, drop cell and target outline. Inputs included transfers, drops outside a frame, an eight-unit retention margin, multi-selection and Alt changes during the drag or on release. Drawing into a plain card and dropping an existing layer beside it use separate upstream targeting rules.

Signed-in Chromium verified the insertion line pixel, Escape, row reordering, a drop into a grid, device recovery and native download. All 1,729 pure tests, two local Auth checks, strict types, both builds and four focused browser tests passed. In separate 10,000-node free-movement benchmarks the 95th percentile was 6.8 ms for movement and 6.2 ms for Alt-copy across 110 measured frames each. Large auto-layout documents still require a dedicated benchmark.

## Canvas sizing and spacing

At 88d2d7c, double-clicking selected frame edges set Hug contents on the local axis. Alt-double-click set Fill container on eligible children, including text. Three rotations passed in Vitest. Chromium also verified ordinary double-click text entry, frame sizing undo, touch text creation and pointer reordering. All 1,732 pure tests, two Auth tests, strict types and both builds passed.

At 8aa940f, the two pinned upstream egui gap-handle tests passed headlessly. The browser port matched the 180-to-200 row gap and the 60-to-50-to-56 item gaps. Separate regressions cover paired padding, zoom, cancellation, grid outlines, independent grid gaps and rotated-frame exclusion. The signed-in browser exercised desktop and narrow touch dragging, modifier handling and saved layout values. An initial check used an exact label-text query that included the select options. The accessible combobox query passed. All 1,736 pure tests, both local Auth tests, strict types and both builds passed. [Interim property matrix](../reports/26-11-09-auto-layout-parity.html).

## Dense layout performance at ebfbaf6

Chromium exercised wrapping and grid spacing in a 10,000-node document arranged as either 100 frames or one frame with 9,998 children. The initial dense frame times at the 95th percentile were 23.5 ms for reordering and 31.1 ms for grid gaps. CPU profiles identified repeated affine checks, shared parent transforms and per-child grid allocations. The final build reuses parent geometry, takes a consecutive-placement path for unit cells, aggregates single-track requirements, and clips offscreen grid guides. All 3,840 native keyboard steps, 2,400 pointer snapshots, 200 nested grid documents and 1,250 mixed flow documents still matched.

Two independent repetitions of all four Chromium scenarios passed. Each repetition measured 60 frames after warm-up. The multi-frame results ranged from 4.3 to 5.5 ms p95. Dense wrapped reordering took 10.3–10.4 ms and dense grid spacing took 15.3–16.1 ms. Retained JavaScript heap growth after collection was at most 987,576 bytes. Each gesture cancelled to the initial document with zero root publications. These are isolated gesture measurements on this machine. Whole-editor long-session profiling remains on the master roadmap. Strict types, both builds, 1,736 pure tests and two local Auth tests passed. Full production Chromium verification started on this build.

## Numeric entry and dense-grid verification at 0306139

The expression parser at 8acf532 matched 3,200 results from the pinned Rust field parser, including rejection, relative percentages, units, decimal commas and nested arithmetic. Chromium exercised frame gaps, paired and individual padding, modifier rates, keyboard stepping, fractional tracks, cancellation and undo. The four signed-in inspector workflows passed. A separate test verified preview ownership across cancelled gestures and multiple selected frames.

The full browser run on ebfbaf6 passed 245/246. The dense grid gap measured 18.5 ms p95. At 0306139 validation reuses repeated sibling ancestry and tests translated bounds directly. Three independent Chromium runs measured 12.8, 11.2 and 11.6 ms p95 on 9,998 children, with no editor publications, correct cancellation and less than 1 MB retained. Strict types, both builds, 1,755 pure tests and two local Auth checks passed. The 247-test full-host rerun is in progress. The local graph includes React beginLayoutField and parseFieldEdit and native right.rs field_of. Two test files yielded no graph symbols and were verified directly.

Continue with the Design inspector’s single and mixed width/height fields, per-layer relative edits, multi-frame clipping and the remaining property-by-property audit. Keep the global baseline unchanged.
