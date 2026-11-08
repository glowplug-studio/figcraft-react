# Outline stroke

## Execution checkpoint

Phases 1–3 complete. Work from be059b7 on prompt/full-figcraft-port. Original, fork and submodule each resolved to 8a7ebc2484a6d64d80a13c19c18ffb814325e347 after sync. The global supported baseline is 8eb0b876. The refreshed local graph contains 29,586 nodes and 97,082 edges. It resolves Rust outline_stroke and fold_cached alongside TypeScript booleanResult and normaliseBooleanPath. The scoped Figcraft Supabase MCP returned zero public tables. This operation belongs to the device document and existing host Auth contract. No schema or network transport is required for it. Rollback be059b7.

## Implementation and acceptance

| Native evidence | React target | Required verification |
|---|---|---|
| engine/src/cmd/structure.rs outline_stroke and shapes_behaviour_tests.rs | vector-commands.ts and existing hierarchy transaction | Replace each selected stroked layer in sibling order. A closed layer with a visible fill keeps its original fill underneath an outline, grouped using its name. Skip unstroked targets. Preserve parent-space transforms, opacity, blend, visibility, constraints and locks for a replacement. Multi-selection and undo are atomic. |
| render/src/draw.rs stroke_fill, stroke_area, pathops stroke_outline_of and rect_side_strokes | Share the tested boolean stroke silhouette and vectorStrokePlan. Retain sides, asymmetric caps, joins, dashes, profile, brush and arrowheads. | Check sampled filled/hole coverage and transformed bounds before and after. Exercise open versus closed, visible per-region fills, nested shapes, brush and one-sided widths using brush_tests.rs, width_tests.rs and width_sides_tests.rs. |
| ui-egui/src/menus.rs and engine/src/keymap.rs | Layer action and native Alt+Cmd+O shortcut through Editor and the command registry | Desktop and 390 px selection, conversion, native save/reopen, undo and redo in the authenticated host. Verify edit denial and the two local Auth cases. |
| Native text, gradients, linked styles and effects | Maintain their dependencies in the master roadmap | Extend Outline stroke coverage when those node/paint types land. Validate again in the final full-product audit. |

1. Extract the shared painted stroke geometry, preserving holes and cap direction. Implement the command using immutable document transactions and direct engine tests.
2. Connect the action and shortcut. Compare actual Chromium pixels and native archive readback. Measure repeated outline/undo and heap on a representative selection.
3. Run strict types, package and Next builds, the pure and local Auth tests and the complete Playwright regression. Record the property matrix, local graph refresh and next operation. Simplify and Offset share painted-region reconstruction and follow this command. Shape Builder follows those operations.
