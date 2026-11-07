# Pen and open-path authoring

## Execution checkpoint

| Field | Value |
|---|---|
| Status | In progress; no Pen workflow or full-product completion claimed |
| Phase | 4: network/command/edit-mode pointer foundation verified; new-path integration next |
| Base / branch | `4a762cd`, `prompt/full-figcraft-port` |
| Upstream | Fork, original and submodule `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; sync succeeded unchanged |
| Global parity baseline | `8eb0b87646c5aef712326d6c431ccde5408630de`, unchanged |
| Last verified | Transform/snapping:763 pure tests,2 real Auth, strict TypeScript/package/Next builds;92 Chromium regression before the final correction and focused rebuilt-host checks afterwards |
| Files in progress | Pen operations, command/state integration, cached targets, edit-mode gestures/overlay and21 fixtures; prior slice commit metadata |
| Blockers | None; hosted React graph remains README-only; current local source is authoritative |
| Next | Commit verified internal foundation, then implement top-level Pen path preview/history and finish/resume transitions, UI/keyboard, authenticated browser/performance verification |
| Updated | 2026-11-07 |

## Evidence and mapping

Both authorised Graphify repositories are queryable. Rust query at the pinned revision resolves `pen_down`, `pen_update`, `end_pen_path`, `PenPlan`, `apply_pen`, `pen_click`, and the native Pen tests. Complete local tool implementation, end/edit/overlay tests and relevant vector pointer/state/command branches supply authority. React returns only four README nodes at `b3b8a1b`; inspect current engine code and refresh the local AST after integration. Scoped Supabase MCP public-table read succeeds (empty); no backend changes are required by Pen.

Source paths below are under `original/figcraft/crates/engine/src`, unless stated otherwise. Relationships remain proposed until paired fixtures and the workflow pass.

| Rust source / symbols | TypeScript target | Observable equivalence / verification |
|---|---|---|
| `canvas/vectoredit/ops.rs::{path_between,connect}` and `connecting_ends_closes_and_fills` | `vector-pen.ts` | Deterministic shortest chain, finite handle fallback, fill only previously unfilled closure between two endpoints; branching and invalid-index fixtures |
| `canvas/vectoredit/pointer.rs::{PenPlan,apply_pen,pen_plan,pen_state,pen_click}` | `vector-pen.ts`, `vector-edit-commands.ts` | New/connect/split plans, relative outgoing/incoming handles, mirrored closing handle, local Shift direction and page command coordinates |
| `canvas/vectoredit.rs::{set_tool,escape,specs}` | `vector-edit.ts`, commands, keyboard integration | Transient anchor/outgoing handle, native pen/penEnd commands; active layer routing; repeated Escape/Enter semantics; undo and native round trip |
| `canvas/tools/pen.rs::{pen_down,pen_update,pen_finish,pen_end,pen_enter,pen_double_click}` | Dedicated `pen-interaction.ts`, editor preview API | No node before two anchors, one history entry per new path, parent-local conversion, closed fill, join, duplicate-last suppression, endpoint resume and finishing transitions |
| `canvas/tools.rs::{at_45_degrees,pen_handles,PenPath}`; `tools/drag.rs::PenDrag` | Pen geometry/controller and Canvas overlay | Page Shift at 45° with retained length, mirrored drag handles after slop, prior outgoing/current handles and cubic rubber band |
| `vectoredit/point_snap.rs::{PenTargets,snap_pen}` | `vector-point-snap.ts` | Cached targets keyed by immutable document/page/edited id/extras; object/pixel switches and Cmd suppression; bounded hover performance |
| `vectoredit/pointer.rs::{vector_down,vector_drag,pen_double_click_editing}` | `vector-interaction.ts` | One history entry per edit-mode click, captured coordinates despite refit, 2px drag threshold, no cross-layer switch while extending, undo accidental initial double-click edit |
| `pen_end_tests.rs`, `pen_vector_edit_tests.rs`, `pen_overlay_tests.rs`, Pen fixtures in `vectoredit/tests.rs` | Paired pure tests and authenticated Playwright | Separate paths in one layer; Escape ends then exits; Enter edits with Move then exits; no double-click stray point; smooth point and outgoing tangent |
| `ui-egui/src/pen_mode_tests.rs`; tool catalogue/key labels | Toolbar, vector panel, keyboard, later mode integration | Accessible Pen/P shortcut; mode changes finish paths. Prototype/Inspect controls remain required in their own roadmap slices |

## Behaviour, hazards and ownership

Implement both native flows. The top-level Pen holds page-coordinate anchors and handles, inserts a vector on the second anchor, and commits the entire path once when finished. It chooses a frame at the first point, transforms points and handles into that parent's space, derives exact cubic bounds, clears fills for open paths and uses a black centred stroke. Closing after at least three anchors adds the default shape fill; clicking an interior anchor connects there without inventing a filled face. Repeated presses on the last point do not add zero-length segments. Selected degree-one endpoints resume the existing layer in edit mode.

Edit-mode Pen creates, connects, branches and splits within the current network. Each click/drag is one history step. Closing onto a point with one previous incident segment mirrors a dragged handle across both sides. A split ignores drag and ends the path. An existing point starts continuation without a geometry/history change; pressing its current anchor ends continuation. `vector.edit.pen` has native page-coordinate x/y and optional dx/dy, without pointer snapping; `vector.edit.penEnd` only clears transient continuation. Switching away from Pen clears anchor/outgoing handle, while selecting Pen again preserves them. Clamp invalid anchors on topology changes and undo.

Escape during a new path keeps its layer and enters edit-mode Pen; the next disconnected path stays in that layer. Enter/double-click changes to edit-mode Move. Before a segment exists, finishing leaves no node. Edit-mode double-click reverses a newly started point/split using the captured history depth, then chooses Move; it must preserve prior document history. Pointer cancellation and identity revocation must discard transient previews without publishing partial or unauthorised changes. Tool switches finish legitimate paths; sign-out remains cancellation. Test these boundaries explicitly.

Keep transient points, snapping, rubber bands and handles outside React. React owns labelled tool controls and committed state; Canvas owns visual previews. Immutable network operations must not mutate captured history. Use ordered adjacency for BFS rather than repeated full-network scans, preserving native segment order and tie results. Use Rust-compatible half-away-from-zero angle rounding. Reject non-finite public coordinates and preserve atomicity; native invalid connection handles individually fall back to zero. Refit must preserve page position, tangents and region paint frames. No Rust runtime, copied executable artefacts, backend types or new dependencies.

## Implementation and verification sequence

1. Implement network connection and pure Pen plans; paired native closure/branch/split/smooth fixtures, degenerate/invalid inputs, deterministic BFS and a large chain.
2. Add transient anchor/outgoing state and native commands; verify parent transforms, active-layer routing, undo/redo, file round trip and error atomicity.
3. Integrate new-path and edit-mode pointer workflows, cache snap targets, overlays/cursor cues, tools and keyboard. Verify history, cancellation, double-click corrections and no React notifications per preview frame.
4. Run focused and full pure/Auth/strict checks and package/Next production builds. Authenticated Playwright covers new/closed/open/resumed paths, modifiers, handles, undo, save/recovery, errors and mobile controls. Fixed screenshots must be inspected. Add 10,000-node hover/handle fixtures with combined p95 below16.7ms, zero root/panel frame notifications and exact cancellation; preserve existing gates.
5. Review the entire diff against upstream, correct failures, write property-level MD/HTML reports, update verified mappings/version, commit and continue immediately through Pencil and dependent region/width/join/boolean workflows and the full master roadmap.

Existing local Supabase Auth and host identity remain authoritative. No schema, profiles, RLS, Storage, Realtime, grants, comments, live-undo or callback changes are required here; online persistence and collaboration remain mandatory later slices. Do not reset unrelated database state or change hosted configuration for geometry. No Vercel, branch publication or main merge before the full-product gate. Rollback base is `4a762cd`; no version bump until the whole Pen workflow passes.

## Internal implementation checkpoint

Independent connection/BFS and Pen new/connect/split plans, native commands, transient anchor/outgoing state, topology clamping, active-layer routing, cached hover targets and edit-mode pointer/overlay integration are implemented. The existing transform box hides while an anchor remains active. Edit-mode double-click uses captured undo depth to reverse an accidental new point/split before choosing Move. No top-level Pen tool/UI is exposed yet; the whole Pen workflow remains incomplete.

21 new paired tests pass; the full pure suite passes784 tests with2 real Auth checks intentionally skipped. Strict package/tests/Next TypeScript and package build pass. Existing Auth was last verified at `4a762cd`; no Auth/provider/schema changes were made. No new browser or full Next production-build claim applies to this internal checkpoint. The package main bundle is620.89kB/gzip173.38kB; this does not measure browser RAM or the Next download.

Initial fixture corrections: (200,-80) is below the22.5° threshold and correctly snaps horizontal; the diagonal fixture now uses(200,-100). Native negative-zero handle equality is checked geometrically, and JSON round-trip comparison normalises signed zero without depending on object-key order. Parent creation uses the existing native `frame.create` command. These corrections did not relax any product or performance gate.

Next: implement the separate new-path controller and preview transaction. It must retain one interaction across pointer releases, choose the first point's frame, preserve exact parent-local cubic bounds and black centred open stroke, support closure/join/resume, and finish correctly for Escape/Enter/double-click/tool switches. Integrate controls/keyboard only with working flows; then run the complete verification/report/version gate. The internal commit is not a completed slice or publication candidate.
