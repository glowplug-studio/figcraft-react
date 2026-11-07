# Vector point and handle authoring — 7 November 2026

## Execution checkpoint

| Field | State |
|---|---|
| Scope | Next required vertical slice in the autonomous full-port run |
| Phase | Phase 7: bounded authoring verified; reports complete, implementation commit next |
| Reference | `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; upstream sync unchanged |
| React | `prompt/full-figcraft-port`; verified internal primitives `74fbbb0`; last complete browser slice `154f5a7` |
| Verification | 735 pure tests,2 local Auth tests, strict TypeScript/package/Next builds and89/89 Chromium pass in146.8s; point input/render p957.9ms, zero root/panel preview notifications |
| Files in progress | Verified version0.25.0 implementation, tests and reports awaiting commit |
| Blockers | No implementation blocker; Graphify authentication restored. Hosted React index remains stale at four README nodes |
| Next action | Commit verified authoring and continue point transform boxes and snapping |

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

Single-thread ownership follows the user's current instruction; no subagents or alternate checkouts. Expected files: new network-edit/session/interaction modules and parity/browser fixtures; focused changes in `editor.ts`, `canvas.ts`, `Editor.tsx`, vector point panel, package exports and reports. Existing rendering/codec modules change only when evidence requires it.

## Pure implementation checkpoint

`vector-edit-ops.ts` implements immutable point movement/transforms, inferred/explicit handle mirroring, selected-handle movement from original positions, smooth/sharp points, curve bending, de Casteljau split, reverse-loop repair, segment deletion, point deletion/healing and merge-on-drop. `vector-edit.ts` implements shape conversion, finite bounds refitting, multi-layer selection/activation/clamping, parent-space selection position, page-space overlays and regional selection metadata. Exact topology comparison replaces a Rust hash without changing invalidation semantics; topology snapshots are released when no region selection remains.

Paired evidence:16 operation fixtures and9 state fixtures pass. Full pure suite696 passes; strict TypeScript and package build pass. New modules are not yet reachable from editor commands/UI and are not evidence of a completed workflow. No new release version or browser claims. Conversion omits zero corners in the canonical TypeScript representation, preventing archive round-trip differences; baked geometry retains their appearance. Source-specific shape fields are removed when converting. Non-finite calculated point/handle mutations refuse atomically; transform operations retain the source snapshot on non-finite results, as native checks require. Whole-network paint-frame movement, reversed loop insertion, multi-layer activation, 500-input limit and native file round trips are tested.

Remaining in this slice: native command registry/parameter contracts, engine history and state clearing on undo/page/file/identity changes, nearest-curve hit testing, pointer capture/previews/cancellation, marquee/midpoint/Bend/Alt handle behaviour, point controls, keyboard actions, authenticated browser recovery/mobile and performance verification. The source runtime cleans vector mode if the active vector disappears or changes page (`doc_state.rs:343`); file changes also clear it. Do not confuse the partial internal state type with the complete native diagnostic command or Pen/width tool state, which still require their own implementation.

## Command and hit-testing checkpoint

Native command integration adds20 registry entries, isolated vector selection subscriptions, conversion-only begin history, multi-layer point operations, page/file/identity lifecycle clearing and atomic failed edits. Twelve command fixtures plus the existing suite pass (708 pure tests, two Auth tests intentionally skipped by this command); strict TypeScript passes. The first focused run corrected a test expectation: deleting an edge retains its newly isolated neighbour, as native removal does. Browser interaction is still outstanding.

Next geometry implementation maps `vectoredit::{hit,hit_any}` to `vector-edit-hit.ts`. Cubic nearest-point distance uses the stationary quintic of squared distance, as the pinned Kurbo0.13.1 implementation does ([primary source](https://docs.rs/kurbo/0.13.1/src/kurbo/cubicbez.rs.html)). The independent TypeScript solver isolates roots through derivative intervals and bounded bisection, rather than sampling a polyline; normalise coordinates before forming coefficients to limit overflow. Check all stationary candidates and endpoints. Preserve local determinant-scaled candidate tolerance, page-space vertex/handle ranking, handle wins on cross-kind ties, stable same-kind ordering and active-layer priority. Paired native fixtures cover short handles, coincident handles and non-uniform transforms; independent curve fixtures cover endpoints, degenerate and multiple-minimum curves. Singular/non-finite hit transforms yield no hit.

## Integrated verification checkpoint

Twenty native command entries, lifecycle guards, precise curve hit testing, transient previews and Canvas pointer routing are integrated. Move supports multi-layer points, segments and handles; Shift selection/axis lock, midpoint/Alt insertion, Bend clicks/drags, deletion/healing and merge-on-drop have source-derived checks. Typed point position/radius/mirroring/cap/join controls, toolbar, Enter/double-click entry and Escape/Done exit dispatch engine commands. Native Select none clears mode; Move/Scale retain it; drawing tools end it and remove empty networks. Keyboard Enter on a focused button retains browser activation semantics.

735 pure tests and2 local Auth tests pass, with strict TypeScript and production builds. Two authenticated browser flows pass, including captured pointer updates with no root commits, one undo, downloaded metadata, recovery reload,390px controls and Bend/deletion routing. The first browser run failed because the test expected `mirroring` instead of the existing typed `mirror` field; the expectation was corrected and both flows rerun. The new screenshot was inspected. The isolated100-edited-layer/10,000-total-node fixture reports5.3ms p95,6.2ms maximum,3.3ms input p95 and zero root/panel preview notifications across110 measured frames; cancellation restores document and point state. Full regression is running on the rebuilt0.25.0 production host.

Supabase MCP public-table read succeeds, no tables or schema changes are required. Graphify access is restored and both authorised repositories were queried: Rust at0b97f3f resolves point-box/transform prerequisites; hosted React still returns an ungrounded README-only result atb3b8a1b. A local AST refresh is running. No user authentication action remains.

Boundaries remain explicit: point transform boxes/resize/rotate/flip/snapping and numerical scrubs are required next; Pen/Pencil, region selection/hatching and paint/cut/eraser, width gestures and booleans follow. Diagnostic fields for those tools remain incomplete. This bounded authoring workflow is not full vector or product parity.

Final verification:89/89 Chromium pass in146.8 seconds with zero skipped, failed or flaky tests. Full-suite point-edit p95/max/input p95 are7.9/8.6/5.4ms, with zero root/panel preview notifications and successful cancellation. Fixed canvas and390px mobile screenshots were inspected. Both owned production servers were stopped after their runs. Reports contain28 bounded Passed rows and a Partial full-product boundary. No required check for this bounded workflow remains failed; no full-vector or full-product completion claim. Local Graphify refreshed to1,566 nodes/7,185 edges; two SQL parser omissions and one symbol-free performance spec remain explicit.
