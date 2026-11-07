# Command validation and sibling reordering

Reference `894d02464325fce04bd7c82fdc7953319ca52df4`. Integrated snap implementation `4b86d41`, branch `prompt/full-figcraft-port`, global baseline `8eb0b876`. [Incoming upstream scope](../reports/26-11-07-upstream-editor-advance.md)

| Source and observed behaviour | React target | Paired acceptance |
|---|---|---|
| create.rs::create, draw_tools_tests::bad_point_is_rejected | createLayer, vector.create and node.create aliases | Each entry is exactly two f64_of-compatible coordinates. Reject a bad entry before allocation. A supplied path takes priority over points. |
| cmd/page.rs::page.move and automation/params.rs::req_index | executePage and required-index parser | Integer in [0,1e9), then clamp to final list length. Reject negative, fractional and malformed indices without history or order change. |
| cmd/edit.rs::node.reorder and doc/lib.rs::reorder | executeStructure and LayerPanel | A required ID, same parent and untouched local transform. Remove child then insert at the requested final sibling position. Reject page root and invalid index. One undo and stable selection. |
| cmd/props.rs and stroke_cap_error_tests.rs | StrokeProps command parser | Invalid strokeCap/startCap/endCap report the offending key and all eight accepted names. Valid aliases, file enum decoding and dash-cap rules retain their native boundaries. |
| doc/lib.rs::frame_relative, frame_relative_ends_on_a_looping_parent_chain | frameRelative | A malformed restored group cycle terminates after at most the native node-count bound. Inspect strict file validation separately. |

Both named Graphify repositories answered. Rust is indexed at 09e04e71 and React at b3b8a1b contains only README nodes. Local source at the recorded commits owns behaviour. Scoped Supabase returned zero public tables. These are local commands using existing protected Next.js routes, session capability and native file/recovery. They introduce no entities, grants or live operations.

Implement source-defined parsing and one in-parent order operation, wire existing layer controls, then verify through direct commands and the authenticated host. Public APIs receive typed JSON from hosts. Include negative, fractional, oversized, nonnumeric and valid coerced inputs, two layer parents, preservation of identity/selection/history, saved order, reload and continued editing after errors. Inspect the native cycle fixture against the engine and file boundaries. Run unit, real Auth, strict TypeScript, package/Next builds and Chromium. Existing 10,000-node performance fixtures guard shared hierarchy. Update mapping, version, changelog and property evidence after verification. Rollback point 4b86d41. Next are changed vector region reconnection semantics and width-point editing.

## Integrated checkpoint

Phase 6. The Layers buttons dispatch node.reorder and preserve geometry, selection and undo. All five native cases have paired TypeScript fixtures, with valid conversions, SVG path precedence, the exclusive 1e9 index limit, stable redo after rejection, native output and a cyclic parent transform. Strict file loading continues to reject structural cycles. 865 pure tests, two local Auth tests, strict TypeScript and both production builds passed. The authenticated Chromium workflow observed overlapping layers change colour and order, undo/redo, native download and persisted recovery. The full Chromium run is in progress. The next action is the per-property evidence report and vector loop reconnection.
