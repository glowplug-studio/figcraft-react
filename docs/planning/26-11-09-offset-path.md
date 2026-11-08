# Offset path

## Execution checkpoint

Phases 1–3 complete. Original, fork main and submodule resolve to 8a7ebc2484a6d64d80a13c19c18ffb814325e347. The scoped Figcraft Supabase MCP lists zero public tables. The current device document and existing local host Auth cover the command. Local Graphify at React 70cf052 has 29,594 combined nodes and 97,145 edges and resolves native offset_path and stroke_center with TypeScript outlineBand, transformNetwork and regionPaintFrame. The code-only graph omits prose and some test declarations. Global supported baseline 8eb0b876. Rollback 70cf052.

Offset is the next operation because it directly consumes the verified cubic boolean and stroke contours. Simplify also needs curve-fitting across joined cubic segments. Shape Builder will require closed arrangements across multiple layers.

| Upstream owner and evidence | React target | Acceptance |
|---|---|---|
| engine/src/cmd/structure.rs offset_path, vector_offset_tests.rs | vector command registry and immutable hierarchy draft | Positive offsets unite a rounded band with the source. Negative offsets subtract the band. Zero leaves content and history intact. Containers with children stay intact. Convert eligible ordinary shapes to vectors in place and preserve sibling order. Multi-target errors roll back. |
| vector_behaviour_tests.rs region_paints_survive_simplify_offset_and_bucket_normalization, legacy_evenodd_holes_survive_bucket_offset_and_flatten, legacy_offset_preserves_the_gradients_world_paint_frame and simplify_and_offset_keep_a_closed_vectors_smoothed_corners | vector-path.ts, vector-rounded.ts, vector-network.ts, path-boolean.ts | Normalise legacy loops together under their winding rule and painted regions independently. Preserve explicit empty fills, inherited fills, reference paint dimensions and transform. Bake the drawn corners, respect holes and discard collapsed negative-offset regions. Check world bounds and local transforms. Full gradient samples follow the gradient-paint milestone. |
| ui-egui/src/dialogs/menu_input.rs MenuInput::Offset, engine/src/catalog.rs | Accessible Offset path action and amount dialog | Default zero, positive or negative signed value, clamp the UI to ±100,000, cancel, apply and undo. Exercise desktop and narrow viewports with native file recovery. |

1. Integrate rounded path expansion/contraction and region reconstruction. Cover the native tests and add dense failure/rollback cases.
2. Wire the real dialog, signed input and save/recovery workflow. Verify exposed edges and hole pixels before and after conversion, with measurements for repeated edits on complex regions.
3. Run the full locally authenticated Chromium suite, strict types, pure and local Auth tests and both production builds. Record the offline property matrix, refresh Graphify and return to the next operation.

## Verified checkpoint

Phases 4–7 passed at dfdffca. Strict types, both production builds, 956 pure tests, two local Auth tests and 128 Chromium workflows passed. Repeated operations on 32 rings in a 10,000-node document preserved the original snapshot on undo. Local Graphify at dfdffca has 2,007 React nodes and 9,806 edges and 29,601 combined nodes and 97,240 edges. The local graph resolves offset_path and offsetLayer. [Evidence](../reports/26-11-09-offset-path.md). Continue with [Simplify vector](26-11-09-simplify-vector.md).
