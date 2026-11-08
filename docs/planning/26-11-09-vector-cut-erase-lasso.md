# Vector Cut, Eraser and Lasso

## Dependency and scope

The remaining three native vector edit tools depend on the existing point gesture, region metadata and cubic geometry. The local code graph confirms cut_vertex, cut_segment, cut_across, inside_ranges and erase in the native engine, plus splitSegment, removeSegments and networkIncident in the independent TypeScript implementation. These tools apply inside vector edit mode. The native board eraser and object-level Shape Builder have separate owners.

| Upstream implementation | React target | Verification |
|---|---|---|
| vectoredit/ops.rs split_segment, reopen_loops, cut_vertex and cut_segment | Immutable cut helpers based on the existing native-compatible split and loop walk | Duplicate coincident open ends, preserve authored geometry, reset endpoint mirroring and rotate cut loops to start at a disconnected seam and preserve their paint metadata. Damaged or invalid inputs leave the original network usable. |
| ops.rs cut_across, parts and part; vectoredit.rs cut_across | Intersect a finite page-space line with editable cubics, extract connected networks and insert refitted siblings through the existing document allocator | Repeated cubic crossings, endpoint clearance, connected component order, closed holes and paint metadata. One undo restores the exact tree and sibling ordering. Preserve parent transforms, name and node properties. |
| ops.rs inside_ranges and erase; vectoredit/pointer.rs erase_all and Erase gesture | Immutable erasure with native circle clearance, 64-interval search, bisection and narrow-intersection detection | Centre, endpoint, full and tangential coverage, very short intersections, missed stamps, determinant and view scaling, repeated stamps, cancellation, one undo and native recovery. |
| ops.rs in_polygon; pointer.rs select_base, select_parts and Lasso gesture | Page-space point selection across edited layers using the shared additive selection model | Non-convex path, minimum sample distance, click and drag, Shift, segment clearing, final active layer and selection-only history. |
| vectoredit.rs command specs and state; toolbar.rs; canvas/overlays.rs | Real tool selection, keyboard bindings as registered upstream, canvas lasso/rubber line and Eraser brush ring | Authenticated Next.js test, stable overlay screenshots, narrow controls and native save/reopen. Real pointer, cancel and undo for each tool. |

Preserve the existing host identity and edit capability. The document file owns geometry. The local point selection and pointer overlays are transient. The slice adds no data entity, grants, migration or Realtime channel. Verify Auth success and denial through the existing local setup. Time the active editing path in the 10,000-node fixture and run the full suite before recording the property matrix. Existing solid region metadata must round-trip. Other native paint kinds remain assigned to the appearance roadmap.

## Execution checkpoint

Phases 1–3. Upstream, fork and submodule at 8a7ebc2484a6d64d80a13c19c18ffb814325e347, global supported baseline 8eb0b876. React a9f8ec6. The recombined local graph contains 29,463 nodes and 96,474 edges, with the optional SQL parser and prose semantics outside coverage. Scoped Supabase MCP verified zero public tables. Rollback base a9f8ec6. Start with deterministic network operations and paired tests, then integrate commands, cross-layer allocation, three pointer modes and overlays.

Phases 4–7 complete at b737b56. See the [verified property matrix](../reports/26-11-09-vector-cut-erase-lasso-parity.html) for the browser fixtures, recovery, performance and remaining product scope.
