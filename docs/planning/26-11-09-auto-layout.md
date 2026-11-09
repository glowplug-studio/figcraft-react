# Auto layout and constraints

## Execution checkpoint

| Field | Current value |
|---|---|
| Reference | Figcraft fork and original upstream at 3839fe4a0cb4897c1fed1fb03e0b60e191ff61cb. React 5a709e9 on prompt/full-figcraft-port. The global supported baseline is 8eb0b876. |
| Evidence | Local merged Graphify index has 31,740 nodes and 104,528 edges. The Rust index links the grid-placement tests to grid_place. The React index links resizeChildren to withLayerSize and hierarchy tests to setRectangleProperties. UI labels and JSON defaults were checked directly. |
| Backend | The scoped Figcraft MCP read returned zero public tables. Layout settings are part of the native document and its existing local persistence. |
| Next action | Implement layout property commands, child sizing coherence and frame authoring. Verify against native command sequences and the signed-in inspector. |
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
