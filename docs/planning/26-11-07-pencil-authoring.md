# Pencil authoring

## Execution checkpoint

| Field | Value |
|---|---|
| Status | In progress; Pencil is not implemented; full product remains incomplete |
| Phase | 4: pressure/sampling primitives verified; curve fitting and workflow integration next |
| Base / branch | Verified Pen `d3c00a4`; `prompt/full-figcraft-port` |
| Reference | Fork, original and submodule `09e04e71765517975950403eec4cb6fbe8955359`; authorised fast-forward from `0b97f3f1` succeeded |
| Global parity baseline | `8eb0b87646c5aef712326d6c431ccde5408630de`, unchanged |
| Last verified | Pencil foundation:814 pure tests, strict package/tests/Next TypeScript and package build. Pen atd3c00a4:2 real Auth, Next production build and97 Chromium checks in231.3s |
| Files in progress | `pencil-samples.ts`,11 paired/boundary fixtures, reference update and checkpoint documents |
| Blockers | None; the complete curve-fitting branch requires further source translation before UI integration |
| Next | Complete pinned Kurbo simplifier/fitter analysis and implementation, then Pencil controller/commands/UI and complete browser verification |
| Updated | 2026-11-07 |

## Evidence and acceptance

Both authorised Graphify repositories are queryable. Rust materialises `pressure_profile`, `pencil_finish` and `the_pencil_records_pressure_and_its_brush` at0b97f3f; these source files are unchanged by the new18-commit range. React remains four README nodes atb3b8a1b, with no grounded implementation answer. Current local sources are authoritative; local AST has1,676 nodes/7,938 edges. Scoped Supabase MCP read succeeds with no public tables. This geometry tool requires no new backend entities, profiles, RLS, Storage or Realtime operation.

Native Pencil starts with one page-coordinate sample and optional f32 pressure. Move and release append only when the distance from the previous sample is strictly greater than0.5/max(zoom,1e-6). Release contributes its final position even if no move preceded it. No snap or Shift-axis constraint is applied. One point produces no node. Live preview is a black polyline of width max(2×zoom,1) screen pixels, including in dark themes, without Pen anchor circles. Finishing creates one open Vector with no fill, black2-unit centred stroke, round cap/join, selected in its first point's containing frame. All path coordinates are transformed into the parent frame. One stroke is one undo operation; cancellation/tool changes/revocation leave no partial node.

Pressure follows source polyline arc length, not sample index: at most32 equally spaced positions; absent/non-finite pressure becomes0.5 where a pressure-bearing stroke needs a value; valid pressure is rounded to f32 then clamped0–1. Width scale is clamp(pressure/0.5,0.1,2). A mouse-only stroke or zero/non-finite total length has no profile. Duplicate sample lengths use the first cumulative length at or above the target, preserving native boundary behaviour. Native `tool.pencilBrush` reads when preset is omitted, clears on null and otherwise parses the existing brush contract; this preference has no history. It applies to future strokes, not existing selection. Existing stroke brush/profile rendering and native codec provide the downstream implementation.

`pencil_finish` calls Kurbo0.13.1 `simplify_bezpath` with accuracy0.75 and default options. Its comment says smooth, but the actual default corner threshold is1e-3; most turns remain corner-separated line segments. Do not substitute an arbitrary spline or discard this corner behaviour. Single-segment runs pass through unchanged; longer sufficiently smooth runs use the area-preserving subdividing fitter, including reversals/degeneracies. That branch must be analysed and independently implemented before claiming complete Pencil geometry. Reference: [pinned simplifier](https://docs.rs/kurbo/0.13.1/src/kurbo/simplify.rs.html), including `simplify_lines_corner`. No Rust execution, linking or bundled source.

## Proposed symbol mapping

Engine paths below are under `original/figcraft/crates/engine/src`; UI paths under `original/figcraft/crates/ui-egui/src`.

| Source / property | Independent target | Verification |
|---|---|---|
| `canvas/tools/pen.rs::pressure_profile`; `brush_tests::pressure_becomes_a_width_profile` | `pencil-samples.ts::pencilPressureProfile` | Native11-point pressure fixture; length interpolation,32-point cap, missing/non-finite/f32 pressure and degenerate inputs |
| `tools/pointer.rs` Pencil down; `drag.rs` and `draw.rs` sample threshold | `pencil-samples.ts`, dedicated `PencilInteraction` | Exact threshold, zoom floor, release-only position, duplicate-pressure rejection, finite guards |
| `tools/pen.rs::pencil_finish`; pinned Kurbo simplifier/fitter | `pencil-path.ts` and separate deterministic fitting module | Native corner fixture, collinear/nearly smooth/reversal cases, fitting bounds and parent-local coordinates |
| `tools/handles.rs::PENCIL_STROKE` | Pencil final properties and Canvas overlay | Black2-unit centred round stroke, max(2×zoom,1) preview; pixel fixtures |
| `cmd/view.rs::tool.pencilBrush`; existing `props::brush_of` | Editor preference using `parseBrush`/`wireBrush` | Omitted/null/invalid preset, scatter parameters, no history and future-stroke-only behaviour |
| `brush_tests::the_pencil_records_pressure_and_its_brush` | Paired engine test and browser pointer fixture | Pressure-bearing tapered stroke then unprofiled/unbrushed mouse stroke; native file/recovery |
| `ui-egui/canvas/overlays.rs::pen_overlay`; `canvas_fixes_tests::the_pencil_previews_its_stroke_in_its_colour_and_weight` | Dedicated Canvas Pencil overlay | Black preview, no anchors, zoom floor, disappearance on release/cancel |
| Tool catalogue, toolbar Pen group and shortcut parity | Editor/Canvas controls; Shift+P | Accessible Pencil activation, focus-safe keyboard handling, desktop/mobile bounds |

## Architecture and hazards

Use a framework-independent controller with mutable sample buffers, not React state or a document clone per sample. Canvas redraws the transient polyline; only completion publishes one vector. Reuse the existing transaction/finite-validation/history/native-format boundaries. Curve fitting belongs in a pure module and runs on completion; measure long strokes so expensive fitting does not silently freeze input. Immutable completed geometry and copied scalar coordinates prevent pointer buffers mutating undo history. Retain f32 pressure precision while geometry remains f64-like JavaScript numbers. Avoid repeated length scans when resampling pressure: cumulative lengths plus a monotonic cursor preserve ties in linear time.

Browser Pointer Events replace native events. Mouse pressure0.5 is not real pen pressure: use pointerType to distinguish mouse from pressure-capable devices; do not manufacture width profiles for mice. Capture/release/cancel and loss of editing capability must clear transient samples. Coalesced-event handling, if used, must preserve order and the same distance threshold; browser substitutions require explicit tests. No new global store, rendering library or dependencies chosen. The full native Draw/Design/Prototype/Inspect switcher remains a later UI dependency, not an excuse to omit Pencil activation now. Marker/Highlighter use board-specific finish behaviour and remain in the board slice.

## Sequential implementation and gates

1. Implement pressure/sample primitives with paired and boundary fixtures.
2. Finish evidence and implement exact corner/run splitting and required fitter branches; test degenerate/finite geometry and frame coordinates. Do not expose an incomplete tool.
3. Integrate native commands/preferences, controller, Canvas preview, Shift+P and labelled controls. Reuse existing brush metadata; no speculative brush UI when upstream has none.
4. Verify one stroke/one undo, Escape/cancel/revocation/tool changes, release-only endpoint, pressure and brush preservation, save/open/recovery and mobile access in the authenticated Next host. Use browser-synthesised pen events for deterministic pressure fixtures; record that physical stylus hardware is not exercised.
5. Add10,000-node drawing/preview and long-stroke completion fixtures; p95 continuous input/render below16.7ms with zero root/panel notifications. Record completion latency separately; do not use preview measurements as a claim about full-host RAM.
6. Run full pure/Auth/strict/package/Next/Playwright checks, inspect visual changes, write property-level MD/HTML reports, update mapping/version and commit. Continue dependent vector tools and the complete roadmap.

The existing Next host owns Auth, validated identity, logout/refresh and protected routes. No ownership/grant/comment/live-undo change is needed. Preserve all provider-neutral boundaries and existing tests; do not reset or alter hosted resources for Pencil. Rollback is `d3c00a4`. No Vercel, branch publication or main merge before the complete-product gate. Single-thread execution follows the user's current instruction.

## Verified internal foundation

`pencil-samples.ts` independently implements strict sample spacing and length-resampled f32 pressure, without exposing a Pencil tool. All11 focused cases and814 pure tests pass; strict package/tests/Next TypeScript and package build pass. Existing2 real Auth tests and97 Chromium checks were verified at the Pen integration, not rerun for this unintegrated pure module. No Next build or completed Pencil browser claim applies yet.

One initial duplicate-length fixture compared rational4/3 against interpolation arithmetic exactly; they differ by one floating-point unit. Interior values now use14-decimal tolerance, while duplicate endpoint/tie results remain exact. Native arithmetic and thresholds were unchanged. No runtime dependency or version change. Next: corner/run splitting plus the complete subdividing fit branch, followed by the controller and authenticated browser flow.
