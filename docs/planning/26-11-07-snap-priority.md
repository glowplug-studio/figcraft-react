# Fractional layer targets take precedence over the pixel grid

Branch prompt/full-figcraft-port; verified React base 20fe465; reference 909d68e0; upstream change 39c58338. Baseline 8eb0b876 remains unchanged. See the [reference advance](../reports/26-11-07-upstream-editor-advance.md). Phase 1 complete; bounded Phase 2 plan below. No external blocker.

| Source symbol | React target | Acceptance |
|---|---|---|
| draw.rs: draw_drag; Targets::snap_point | DrawInteraction.move; drawnLine / drawnRectangle | Round the start and raw endpoint with Rust tie semantics; object corrections then win on each captured axis. Keep free axes on-grid; apply Shift/Alt geometry afterwards. |
| drag.rs: move gesture; Targets::round_move / snap_move | MoveInteraction.move; SnapTargets.roundMove / snapMove | Native snapping_to_layers_wins_over_the_pixel_grid: move B to (−44.5,302), guide at 5.5; unsnapped movement lands at (210,311). Preserve the parent coordinate frame. |
| drag.rs: resize gesture; axis_aligned | TransformInteraction.move; PointSnapCache | Left handle lands at 5.5, unconstrained bottom gives height 151. Scale stays continuous; rotated frames bypass grid; Ctrl/Meta suspends object snapping only. |

Graphify located round_move in canvas/snap.rs at the older 09e04e71 Rust index. The README-only React index has no DrawInteraction; current files and native fixtures take precedence. No new command, file field, React control or desktop omission. Page coordinates and zoom determine capture distance, not CSS coordinates. Reuse the existing gesture caches and preview/commit history; keep pointer frames outside root React state. File save and recovery must preserve fractional geometry. Host login, logout, protected routes and capabilities are unchanged. Scoped Supabase has no public application tables. No data, RLS, ownership, membership, grants, profiles, Realtime, comment identity or live undo change is needed for this local edit.

Sequential implementation: reproduce the native move/resize case and both draw geometry families, correct the three controllers, verify suppression, free axes, undo and captured guides. Exercise the authenticated Next.js canvas using a deterministic file; save and inspect geometry. Run full unit, local Auth, strict TS, builds and Chromium, including existing 10,000-node preview timing and no React notification gates. Inspect browser evidence; update package patch, mapping, Markdown/HTML report and both checkpoints. Revert the bounded implementation if geometry or timing regresses. Next: strict index/point validation, vector reconnection, width-point editing, then remaining roadmap. No partial publication.

The current draw tool accepts Rectangle, Ellipse, Polygon, Star, Line and Arrow. Frame creation is command-based; Frame/Section/Slice drag tools are tracked separately for full tool parity and are not claimed by this correction.

## Integrated checkpoint

Pixel rounding now precedes object correction in all three gesture controllers. Seven focused geometry cases demonstrated the prior rounding error; the eighth checks capture eligibility on either side of the five-pixel threshold. 860 pure tests and two real local Auth checks passed. Strict TypeScript and both release builds passed; main package entry 653.61 kB / 182.73 kB gzip. Authenticated Chromium passed the fractional guide pixel, exact move and resize geometry, drawn shape, native download and recovery. Full headless regression against the running local release build is underway. No publication. Next: record the full result and performance evidence, then index/point validation.
