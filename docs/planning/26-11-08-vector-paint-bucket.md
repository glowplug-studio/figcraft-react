# Vector faces and Paint bucket

Phase 7 complete for face discovery and solid Paint bucket authoring. Base 880a580. The original, fork and local Rust reference are 8a7ebc2484a6d64d80a13c19c18ffb814325e347. Hosted Graphify resolves paint_all → edit at the same revision. Its file-to-test lookup for vector_faces.rs returned no links although the file contains seven native fixtures. Hosted React at b3b8a1b contains four README nodes and cannot resolve executeVectorEdit or vectorRegionPath. The combined local index contains both symbols and 29,394 nodes. The project-scoped Supabase MCP returned zero public tables.

| Upstream evidence at the pin | TypeScript owner | Verification |
|---|---|---|
| doc/vector_faces.rs cycles, half_edge_dir and split_loops | New pure vector-faces module using networkCubic | Diagonal divides a square, lens curves enclose area, dangling paths and bridges drop out, invalid endpoints and zero lengths terminate. Verify cubic signed area, angular ties and stable traversal. |
| faces, face_at and interior_point | Vector face geometry and existing vector-path winding | Keep only immediate disconnected holes, choose the smallest containing face, test even-odd nested pieces and interior probes against true paths. |
| paint_to_with and paint_all | Face region transformation and vector-edit-commands | Decompose non-face legacy or styled regions, preserve paint frames, remove all duplicates, freeze untouched inherited empty regions if a default fill is installed. A missed initial stamp lets the first valid hit choose the action. All misses produce the upstream error without document mutation. |
| vector.edit.paint and vectoredit/tests.rs | Command registry, existing vector edit engine, affine inverse | Page coordinates or up to 10,000 valid point pairs, one undo unit, repeated fill or unfill without toggling again. Include transformed geometry and mixed styles. |
| VTool::Paint, pressed_layer, vector_down, vector_move and vector_up | VectorInteraction, vector-edit-overlay, existing toolbar and keyboard handler | B and Shift+B in edit mode, active-layer precedence, face picking on other edited layers, hover only through 3,000 segments, 2 screen-pixel stamp spacing, commit or cancel without root React updates. |
| Native region serialisation and paint rendering | Existing vector codec, local recovery, vector-presentation | Check pixels in affected and untouched regions, undo/redo, save/reopen, recovery and mobile viewport with authenticated Playwright. |

Use double-precision geometry on authored points. Preserve stable angle ordering, directional tangents, rule parity and separate inherited versus explicitly empty stacks. Use a bounded half-edge walk and reuse computed geometry for immutable topology across drag previews. Render hover in the existing canvas render loop. No native shell dependency. Benchmark hover and drag in the 10,000-node fixture, with input, drawing and pan p95 under 16.7 ms and zero root notifications.

Existing host identity, file serialisation, Auth adapter and local recovery cover this slice. All edits go through the existing edit capability and history boundaries. Region geometry adds no database entity, share grant, new session state or realtime payload. The separate selected-region paint inspector introduced in the latest reference remains required in its own roadmap work.

Implement sequentially in the canonical checkout. First port geometry and test the native fixtures, then immutable paint transactions and command parsing, pointer and inspector integration, file and performance verification. Use 880a580 as rollback point. Run pure and real local Auth tests, strict TypeScript, both builds, the focused browser flows and all Chromium checks before publishing a property matrix. Full-product publication remains gated.


## Verification checkpoint

The face walk, region normalisation, Paint bucket command, pointer gestures, hatched hover, toolbar and shortcuts are integrated. Twelve geometry, command and gesture fixtures pass, including preserving explicit paint frames, selecting another edited layer, skipped invalid pairs and the 10,000-stamp cap. The complete pure suite passed 900 tests and the local Supabase Auth suite passed both tests. Strict TypeScript passed. Focused authenticated Chromium checked the desktop hover snapshot, mobile toolbar, cancellation, two-face drag, undo, recovery and native regions. Review adjusted hover flattening to a quarter screen pixel and default fill assignment to use the refitted network. Rebuild the production preview and complete the final one-worker browser regression before closing the slice.

Native gradient, image and pattern region paints in vector_behaviour_tests.rs also depend on the wider paint model and renderer. Re-run the region stack round-trip cases when those paint kinds are implemented. The solid paint stack and its authored coordinate frame have direct coverage here.

Implementation 94273da and toolbar screenshots 50370fe. The initial full browser run exposed a stale full-canvas capture which included the old toolbar. Refreshed the two affected captures after pixel comparison. Changes above two colour levels are confined to the toolbar. Rerunning the full suite against the final production build. The refreshed combined local graph has 29,427 nodes and 96,252 edges, including Rust paint_all and the TypeScript paintVector owner. Two SQL files lack local parser coverage.

Final production regression at 50370fe passed all 111 Chromium checks in 236.0 s without retries or skips. The 10,000-node fixture measured 4.40 ms drag and draw, 2.70 ms input and 2.20 ms hover and pan at p95. All 13 report rows and 23 local links were checked. [Verification report](../reports/26-11-09-vector-paint-bucket.md).
