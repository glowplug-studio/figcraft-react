# Rotation origins and transforms — 7 November 2026

React0.12.0, implementation `92062ca`, branch `prompt/full-figcraft-port`; upstream evidence `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. Global baseline remains `8eb0b876`; complete port still in progress.

Added transient rotation origins stored in the first selected layer's coordinates, oriented selection boxes, nine-point screen-distance snapping, canvas ring/cross dragging and double-click reset, Alt+R/Escape, inspector origin/rotation/flip controls and Shift+H/V. Native rotation commands and rotation fields honour a moved origin only for the exact ordered selection; flips retain page-bounds centres. Geometry changes are atomic/undoable and survive native save/recovery. Origin state follows movement/undo, clears on selection/access changes and is never saved or added to history. Only the small origin panel subscribes to origin changes; canvas rendering remains outside React.

Verification: strict TypeScript,365 pure tests,2 real local Auth checks, package/Next production builds,34/34 Chromium checks in52.4s. New browser flows verify origin drag/snapping with unchanged root commit count, move/undo, native signed rotations, field pinning, flips/shortcuts, double-click reset, Escape, save/recovery and mobile controls. No browser errors or failed requests. Inspected generated `test-results/rotation-origin-handle.png`; logs/screenshots remain ignored and regenerate from the suite. Test Auth users removed; no permanent account retained.

Performance over110 measured frames: groups p95/max7.2/12.6ms, Frames8.4/11.6ms, moving Frames13.5/16.8ms, plain rectangles1.1/1.2ms, affine5.3/9.1ms, moving affine4.1/10ms. Pointer/render p95 both0.1ms. These are local Chromium measurements, not hosted claims.

Scoped Supabase MCP public-table read succeeded (empty); no schema/provider/RLS/Storage/Realtime changes. Current local Auth tests pass. Graphify Rust index current; React still stale/README-only. Source inspection and independent TypeScript fixtures, no Rust execution. No push, deployment or main merge; no user action required.

Remaining gaps: general canvas move/resize/corner-rotation gestures, smart spacing/reordering, preferences, vector/text origin editing and unsupported kinds. Next slice: smart-selection tracks, reorder and interaction transactions. [Property evidence](26-11-07-rotation-parity.html).
