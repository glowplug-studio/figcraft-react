# Vector point transforms and snapping

## Execution checkpoint

| Field | Value |
|---|---|
| Status | Bounded transform/snapping workflow verified; full product remains incomplete |
| Phase | 7 complete: verified implementation `4a762cd` |
| Base | `adc59d4`, branch `prompt/full-figcraft-port` |
| Upstream | `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; global parity baseline unchanged |
| Verified foundation | 735 pure tests, 2 real Auth, strict TypeScript/package/Next builds, 89 Chromium checks |
| Next | Continue the Pen/open-path plan; full-product roadmap remains active |
| Blockers | None; hosted React graph remains README-only and current local source is authoritative |

## Evidence and mapping

Upstream sync completed unchanged before this analysis. Both authorised Graphify repositories are queryable. Rust query resolves `point_box` and `vector_edit_box` at the pinned source; its clipped result is supplemented by complete local `transform.rs`, `transform_tests.rs` and `point_snap.rs`, and focused pointer/arrangement/UI reads. React query has no grounded implementation result (four README nodes at `b3b8a1b`); current local engine files and the existing local AST index supply impact evidence. The scoped Supabase public-table read succeeds and returns no tables.

| Native source/symbol | TypeScript target | Observable contract and verification | Current confidence |
|---|---|---|---|
| `canvas/vectoredit/transform.rs::point_box`, `PointBox::onto` | `vector-point-transform.ts` | Active-layer axes, segment ends, finite bounds, degenerate axes; paired numeric fixtures | Low until tested |
| `layers_box`, `shown_box`, `transform_box` | Same module and `vector-interaction.ts` | Multi-layer page axes, two-point visibility, one captured transform across all selected layers; paired rotated-layer fixtures | Low until tested |
| `transform.rs::specs`, `transform_points` | `vector-edit-commands.ts` | Bounds, resize, rotate and explicit page matrix; active layer only, one undo, finite overflow no-op | Low until tested |
| `cmd/arrange.rs::flip`, `rotate_by`, `transform_in_edit_mode` | `rotation.ts`, `editor.ts` | With no explicit id/ids, selected active points override layer transforms; explicit targets retain layer behaviour | Low until tested |
| `pointer.rs::box_down`, BoxScale/BoxRotate updates; `box_hit` | `vector-interaction.ts`, overlay | Point/Bezier priority; edge/corner/rotate/inside priority; Shift proportions/15° rotation, Alt centre; one undo/cancellation | Low until tested |
| `point_snap.rs::targets_moving`, `snap` | Dedicated point snapping plus existing `snapping.ts` | Page targets, selected-point exclusion, bounded collection, object and pixel modes, final guides | Low until tested |
| `ui-egui/src/panels/vector_panel.rs::points` | `VectorPanel.tsx` | Width/height only for more than one selected point; commands own changes | Low until tested |

Paths in the first column are under `original/figcraft/crates/engine/src` except the UI path under `original/figcraft/crates`.

## Acceptance and hazards

Preserve the native numeric fixtures: 100-square width becomes 50 with top-left fixed; centred height 200 spans -50 to 150; positive 90° is counter-clockwise; explicit page transform maps the selected (100,0) point to (210,0). Resize clamps to 0…10,000,000 and invalid optional numbers retain existing values. Matrix arrays filter invalid numeric entries and require six surviving coefficients. Overflowing geometry changes nothing atomically. Empty selection errors for bounds/resize/rotate, while explicit transform vertices can work without selection. A single point has zero dimensions; axes at most 1e-9 must not scale or translate through box resizing.

Numeric properties use the active layer even when other edited layers have selected points. Canvas box transforms use all selected layers and page axes when another layer is selected. Refit must preserve page-space position, relative handles and region paint frames. Keep explicit id/ids routing distinct, including null-valued keys. Test nested/rotated parents, segment endpoint selection, untouched neighbours, native save/open and history.

Checked general affine helpers reject non-finite intermediates; vector transforms instead need native atomic no-op semantics. Confine unchecked intermediate arithmetic to this operation and let the existing network transform reject non-finite output before mutation. No general weakening of document validation. No Rust execution or dependencies.

Follow-up gesture evidence must cover point/handle priority, zero-extent edges, interior click clearing versus drag, multi-layer frames, re-fitting during captured previews and live modifiers. Snapping must retain native 20,000-point/200,000-node/256-moving-point bounds, object suppression by Ctrl/⌘, pixel rounding and guides calculated after axis locking. Pen-specific consumers remain a required later tool slice; do not add stub tools.

## Ownership, providers and verification

Geometry and captured gestures stay in the framework-independent engine. React observes committed selection/document changes only; no per-frame root or panel notifications. Canvas renders the box/guides. Existing host identity, Auth, callbacks, protected routes and sign-out clearing remain authoritative. No new roles, grants, schema, profiles, RLS, Storage, Realtime, retention, comments or live-undo contracts are required by this local geometry slice. Those remain explicit master-roadmap obligations.

Work sequentially per the user's current instruction. Expected files: new point transform/snapping engine modules and paired fixtures; command/rotation/editor routing; interaction/overlay/canvas; vector panel; authenticated preview and performance tests; dated reports/mapping/version records after verification. Rollback point is `adc59d4`.

Run focused paired tests after each mathematical/command step, then full pure/Auth/type/build checks. Verify authenticated numeric fields, box gestures, modifiers, undo/cancel, recovery, fixed screenshots and mobile layout through Playwright. Extend the 10,000-total/100-visible/100-selected-point fixture to transforms and snapping: combined p95 below 16.7ms, zero root/point-panel notifications during previews, exact cancellation. Final full-host memory and long-session testing remain mandatory at full-product audit; this fixture is not proof of unrestricted complexity.

After this complete workflow passes, write the required property-level HTML/report, update stable mappings and version, commit, and continue immediately through the remaining vector and master-roadmap families. No partial publication or main merge.

## Implementation and verification checkpoint

Point boxes, four commands, fixed rotation/flip routing, dimensions UI, captured scale/rotate/interior gestures, point/handle snapping, object/pixel switches and marker overlays are implemented. The switches also govern existing shape draw/move/resize paths. Native kept preferences and guide/grid targets remain dependent master-roadmap work; their semantics must be integrated when those models land.

763 pure tests (28 new), 2 real local Auth tests, strict TypeScript and package/Next builds pass. The authenticated transform/recovery/mobile workflow passes. Three 10,000-node performance cases pass with combined p95 move 5.7ms, scale 4.1ms, rotate 4.2ms, zero root/point-panel notifications and exact cancellation. Initial linear snapping failed at 86.1ms; captured sorted coordinate indexes fixed it while a 100-case differential fixture preserves native candidate ties. Global threshold remains 16.7ms.

First full Chromium run stopped the serial authenticated file at the expected changed View-controls screenshot:28 passed,1 failed,63 did not run. Screenshot changes must be reviewed, then the complete suite rerun without update mode. Do not count skipped serial tests as passing. Version0.26.0 metadata is prepared but not committed. Full-host stability and complete parity remain unproven.

Final verification: full92-check Chromium regression passes in203.9s without screenshot updates; all ten changed baselines differ only inside View-control bounds x416…990/y8…47. Final numeric fallback/UI correction is covered by the full763-test pure suite, strict checks, rebuilt package/Next host and the extended authenticated wide-vector test. Authoring and all three performance cases pass on that rebuilt host. Reports contain36 bounded Passed properties plus a full-product Partial row. HTML links/13-column structure/hygiene verified and local rendering inspected. No process, external blocker or user action remains for this slice.
