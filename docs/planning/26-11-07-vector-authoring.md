# Vector point and handle authoring — 7 November 2026

## Execution checkpoint

| Field | State |
|---|---|
| Scope | Next required vertical slice in the autonomous full-port run |
| Phase | Evidence and design; implementation not started |
| Reference | `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; upstream sync unchanged |
| React | `prompt/full-figcraft-port`; vector foundation verified from mathematics `cb5417d`, commit being recorded |
| Verification | Foundation671 pure/2 Auth/86 browser passes; authoring tests not written |
| Files in progress | This plan only |
| Blockers | Hosted Graphify authentication expired; local source and local React graph available |
| Next action | Finish and commit vector foundation, then implement independent point/handle operations and paired fixtures before session/UI integration |

## Acceptance and dependency order

The next workflow is entering vector edit mode on supported shapes, selecting and moving points/segments/handles, editing point position and handle mirroring, smoothing/sharpening, bending, inserting points and deleting/healing points, then leaving edit mode and recovering the native file. Preserve multiple edited layers, active-layer switching, conversion history, geometric refitting without page-space movement, failed-operation atomicity and one undo step per gesture. Native limits include at most 500 edited layers and bounded parsed handle/region selections. No new speculative drawing tool or provider capability.

Implement sequentially: pure network operations and source-derived fixtures; session selection/lifecycle/refit and commands; pointer hit/drag/marquee and keyboard dispatch with Canvas overlays; accessible React point controls; authenticated native-file/recovery/mobile workflows, performance, diff review and property report. A pure module checkpoint is not a completed vertical slice. Pen/Pencil, paint bucket/region hatching, cutting/eraser, point transform box/snapping, width gestures and booleans remain separately required dependencies/workflows; do not expose unimplemented tools or claim all vector editing is complete.

## Evidence and mapping

All Rust paths below are under `original/figcraft/crates/engine/src/` unless stated. They are read-only evidence, never runtime or test dependencies.

| Upstream symbols | Observable contract | TypeScript target | Verification |
|---|---|---|---|
| `canvas/vectoredit/ops.rs::{move_vertices,transform_vertices}` | Deduplicate selected indices; move relative handles with anchors; map handle linear parts; whole-network edits move regional paint frames | `engine/vector-edit-ops.ts` | Independent affine/paint-frame and non-finite fixtures |
| `ops::{set_handle,move_handles,set_mirroring}` | Inferred/explicit mirroring, independent Alt break, original handle snapshots, longer-direction and mean-length rules | `vector-edit-ops.ts` | Native `handles_follow_mirroring`, unequal/zero lengths and selected opposing handles |
| `ops::{make_smooth,auto_smooth,make_sharp,bend}` | Incident direction scoring; neighbour chord at one-third distances; sharp clears override; bend clamps parameter to 0.05–0.95 | `vector-edit-ops.ts` | Native `smooth_and_sharp`, bowed-point fixture and curve-through-point invariants |
| `ops::{split_segment,remove_segments,delete_vertices,heal_handles,reopen_loops}` | De Casteljau split with 0.01–0.99 clamp, backwards loop insertion, stable metadata, index repair and curve healing | `vector-edit-ops.ts` | Native reversed triangle, deletion/healing cases, split-curve samples and painted-region retention |
| `vectoredit::{ensure_vector,refit,begin_many,end,clamp_doc}` | Shape conversion retains look, resets corners, Line stays open/centre stroke; conversion adds history; empty layers removed at exit; undo clamps edit state | New `vector-edit.ts` and `EditorEngine` integration | Native `undo_back_past_the_conversion_leaves_edit_mode`, empty layer and multi-layer fixtures |
| `vectoredit::{point_sets,selected_points,selection_position,local_offset,specs}` | Native command identifiers, local/page/parent coordinate distinctions, selected segment endpoints, active versus all-layer targeting | Command reducer and isolated edit-state subscription | `vector_multi_behaviour_tests`, command/error/undo/native archive tests |
| `vectoredit::{visible_handles,hit,hit_any,overlay}`, `pointer.rs` | Visible handles versus points compared in page coordinates, handles win ties; active layer first; segment tolerance; transient gestures | New vector interaction/overlay helper and `CanvasController` | Native short-handle/non-uniform scale/tie tests; real pointer/midpoint/Alt workflows |
| `vectoredit::key`, UI `shortcuts.rs`, `toolbar.rs`, `canvas/overlays.rs` | Enter/double-click enter; Escape/Done leave; selection/nudge/delete/heal keys; edit overlay and stable panel width | `Editor.tsx`, `VectorPanel.tsx`, Canvas overlay | Authenticated keyboard, fixed screenshot and narrow-screen workflow |

Current source definitions and fixtures are authoritative. Hosted Graphify returned an authentication error twice; reauthorisation was requested without opening a browser. The prior Rust graph resolved vector dependencies, but this slice has no fresh hosted graph result yet. The local React graph (1,425 nodes) locates `EditorEngine`, preview methods and dependent tests; its bounded query truncates neighbours and is not an exhaustive impact audit. Scoped Supabase MCP public-table read succeeds. Fork and original upstream remain at the pinned reference.

## Hazards and architecture

Network edits operate on isolated drafts, returning frozen immutable snapshots; no cache may observe mutation of an existing network. Read handles before moving a selection so mirroring cannot compound earlier moves. Source ordering matters for incident edges, nearest ties, reverse loop insertion and delete-index repair. Preserve point and region metadata through every operation. Numeric fixtures cover parameter clamps, invalid indices, degenerate/zero handles, affine parent spaces, singular inverses and finite-result checks; do not replace source geometry with CSS layout or screen-space approximations.

Refit computes stroke bounds, translates network coordinates and postmultiplies the node transform by the bounds origin. It must not use ordinary resize helpers, which would scale the edited network twice. Rounded vector bounds follow existing source-compatible geometry. Shape conversion clears baked corner parameters. Point coordinates and handles remain independent of the host/backend and retain native wire fields already supported by the vector codec.

Edit selection/tool state is ephemeral, outside document persistence. The engine owns it and command transactions; React subscribes only to stable chrome snapshots. Pointer previews derive from a captured document/edit state, publish only to the Canvas subscription and commit one history item. Cancel restores both geometry and ephemeral selection as native evidence requires. Undo must clamp indices and exit if no edited vector remains. Existing layer-level keyboard/pointer handlers must yield to vector mode without blocking text inputs, pan or zoom.

Canvas 2D and browser pointer capture are the existing standards-based rendering/input substitutions. Test 10,000 total nodes with a representative visible edited network and multi-layer point selection across 110 measured frames after warm-up: p95 render/input within 16.7ms, no root React notifications during previews, stable cancellation and bounded cache use. This does not discharge complete-host RAM/long-session obligations.

## Provider and verification boundary

No tables, migrations, Storage, Realtime, profiles or roles are required for local geometry editing. Existing validated host identity, capability gating, sign-out clearing and principal-scoped recovery remain the boundary. Run shared/local Auth tests alongside the final integrated suite; do not reset unrelated databases. No tokens, shares or identity attributes enter vector state or native files.

After pure operations: strict TypeScript and focused paired fixtures. After command integration: complete pure suite and archive/history/error tests. After UI/pointer integration: production package/Next builds, authenticated Playwright workflow, pixels/screenshots, mobile controls, browser/network error checks and all performance fixtures. Correct failures before marking the slice verified. Record independent properties with explicit remaining gaps in a self-contained HTML matrix and Markdown report. Rollback is the verified vector-foundation commit; no partial publication, branch push or main merge.

Single-thread ownership follows the user's current instruction; no subagents or alternate checkouts. Expected files: new network-edit/session/interaction modules and parity/browser fixtures; focused changes in `editor.ts`, `controller.ts`, `Editor.tsx`, vector point panel, package exports and reports. Existing rendering/codec modules change only when evidence requires it.
