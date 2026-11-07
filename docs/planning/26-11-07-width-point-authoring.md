# Variable-width point authoring

React base 04b64a2. Reference ed90dc103bac791ee917184418df10f4ef133c96. The stroke already renders and saves width profiles. This slice adds native editing of those profiles on the active vector. Use the existing document, hierarchy, local file, Auth and recovery contracts. The project-scoped Supabase read returned zero public tables. Hosted Rust Graphify at 7522c39b identified width_down → profile_of, put_profile and width_hit. The React graph at b3b8a1b contains only the README.

| Native source in original/figcraft/crates | React owner | Acceptance |
|---|---|---|
| doc/src/props.rs, engine/src/canvas/vectoredit/width.rs width_point | width-profile, vector-edit-commands | Add interpolated points, preserve one side, move between neighbours, remove through the shared stroke setter. Match strict indices, native errors and width versus scale. |
| width.rs handles, width_hit, width_preview, pointer_at | path-measure and vector geometry | Measure each subpath, transform normal to page space, honour 8 px minimum handles and 6 px tolerance. Verify rotated, compound, thin and asymmetric strokes. |
| width_down, width_drag, width_up | vector-interaction and editor transactions | Each drag is one undo. Replay against original geometry. Alt affects one side, cancellation restores the original profile, selecting an existing point adds no history. |
| ui-egui vector_panel.rs, overlays.rs, engine vectoredit.rs | VectorPanel, canvas overlay and keyboard | Shift+W, hover, active widths and centre markers, inspector position/full/left/right, Delete and mobile controls. Verify native persistence and recovery in authenticated Chromium. |
| width_tests.rs and width_sides_tests.rs | paired pure and browser fixtures | Retain strict build, Auth and full Chromium checks. Measure repeated previews at 10,000 nodes and 100 visible layers, p95 under 16.7 ms and zero root/panel updates. Capture a fixed viewport and validate the property matrix. |

## Checkpoint

Phases 1–3 complete. Implement the profile operation and paired command fixtures, then geometry, gestures and UI. Source inspections and changes run sequentially in the canonical checkout under the human's execution directive. Rollback base 04b64a2. Final publication remains gated.

## Integrated checkpoint

React 0.31.0. Six paired case groups exercise authored width points, both sides, malformed inputs, capture, compound paths, affine handles and finite limits. All 879 pure tests pass. Both real local Auth checks pass separately. Strict TypeScript, the package and Next.js production builds pass. Authenticated Chromium verified Shift+W, captured Alt-drag, both side lengths, inspector position, Delete, undo, native download, reload and the mobile toolbar. The fixed viewport capture shows three points and the asymmetric band. The focused width performance fixture measured p95 2.7 ms including input and drawing across 100 visible edited layers in 10,000 nodes, with zero root or inspector notifications. Full Chromium regression and the Phase 7 report remain pending.
