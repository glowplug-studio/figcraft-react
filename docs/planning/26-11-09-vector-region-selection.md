# Painted vector region selection

Base dad5382a. Phase 1 verified the original, fork and submodule all at 8a7ebc24, the scoped Supabase read with zero public tables, and the local combined graph with 29,427 nodes and 96,252 edges. The graph locates hatched_regions and region_hatch in the Rust engine, plus hitEditedVectors, regionPoints and selectVectorParts in the React port. Direct source provides the pointer methods and fixtures. This slice supplies selected regions to the later paint inspector.

| Native behaviour and owner | React target | Acceptance evidence |
|---|---|---|
| regions.rs region_hit; doc drawn_network and region_contains | vector region hit test, vector-rounded and vector-path | Visible stack on active layer or region. Reverse region order selects the topmost containing area. Holes, smoothing and mixed explicit/inherited stacks. Exclude authored vertices within 3.5 screen pixels and segments within 2, scaled by the determinant. Reject non-finite input or unusable zoom. |
| pointer.rs region_under, region_down, vector_hover, box_hit; vectoredit.rs shown_vertices and region_topo | VectorInteraction, vector-edit state and editor command snapshot | Bezier and transform handles take precedence. A box around individually selected parts takes an interior drag unless the region is selected or Shift is held. Shift adds or removes regions with shared vertices retained; ordinary click on selected region keeps other selected parts. Clear stale hover on exit, tool or topology change. |
| regions.rs hatched_regions, hatch_spacing, hatch_lines, clip_to_area and region_hatch; canvas/builder.rs region_hatch | Pure screen geometry and canvas overlay | Bottom-left to top-right, 1.4 px accent, octave-folded 8 px spacing, anchored to layer origin under pan and movement. Clip visible bounds and respect each region's native winding. Draw selected regions once, omitting hover during a gesture. |
| regions_tests.rs movement and topology fixtures | Existing point movement, snapping, engine transient transaction and native codec | Move region and independently selected points across layers once. Cancel restores the original network; one undo restores a committed move. Selection by itself has no history or saved file representation. |

Implement sequentially. First port hit and selection geometry and paired tests. Then integrate hover, drag, overlay and regionHover in vector.edit.state. Verify with real browser clicks, Shift, pointer exit, screenshots showing winding and hatch placement, native recovery, narrow viewport, and the 10,000-node interaction/render budget below 16.7 ms p95. Run pure and local Auth suites, strict TS, both builds and full authenticated Chromium before reporting.

Use validated host identity and the existing editable session boundary. No new cloud entity, grants, RLS policy or Realtime message. The core retains transient pointer state outside root React and uses the current immutable document for persistence. Keep Rust float rounding semantics at negative half-octaves, guard excessive index ranges and do not fabricate EPS comparisons for rule changes. Check related sources directly when the graph lacks test links.

## Checkpoint

Phases 1–3 complete. Rollback base dad5382a. Implemented hitPaintedRegion, octave spacing, origin-anchored screen hatching and fill-rule clipping. Four paired tests and strict TypeScript pass. Next connect region picking to Move pointer hover/down, native Shift selection, existing point gestures, vector.edit.state and the screen overlay. The independent Paint bucket hatch uses a different spacing, direction and outline; its native screenshot remains a regression check.

Phase 4 integrated native Move hit priority, shared region vertices, pointer exit, tool and topology invalidation, command introspection and hatch rendering. The authenticated desktop fixture and 10,000-node selected-region benchmark passed. Existing empty-space and marquee fixtures now start outside the painted area, preserving their original assertions. The first pure run caught those two fixture conflicts. Full Chromium and the narrow-view check are in progress.

## Verified checkpoint

Phases 5–7 passed on React 59700e8 and native 8a7ebc24. All 908 pure tests, two local Auth tests and 113 Chromium checks passed, with strict TypeScript and production builds. A provisional regression passed 111 of 113 checks. Correcting the narrow viewport locator and the multi-layer scale fixture restored the full suite. The benchmark now checks the actual point count and far-layer movement. Region p95 was 3.6 ms for input, 5.7 ms for drag and draw and 3.6 ms for hover and pan. See the [property matrix](../reports/26-11-09-vector-region-selection-parity.html). The next dependency is selected-region fill editing.
