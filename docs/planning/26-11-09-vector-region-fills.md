# Selected vector region fills

## Evidence and dependency

Painted-region Move selection supplies stable region indices on the active vector. Native selected_region_fills returns the shared effective paint list or mixed content. A region without its own list inherits the layer's fills. A stored empty list is meaningful. The regional editor, persistence and renderer already understand solid paint overrides.

| Upstream implementation | Independent React target and contract |
|---|---|
| engine/canvas/vectoredit.rs selected_region_fills; ui-egui/panels/right/paints.rs paint section | Subscribe the appearance inspector to committed vector selection. Show the active region stack for one target. Mixed stacks expose the native mixed state. Layer opacity and stroke controls keep their own targets. |
| engine/cmd/edit/props.rs fill_regions, edit_region_fills | Resolve implicit selection and explicit indices with one vector target. Reject malformed, empty and out-of-range explicit lists. Deduplicate repeated indices. Validate and apply the command atomically. Preserve inheritance on no-op edits and distinguish explicit empty. |
| engine/cmd/edit/props.rs paint_list and paint_set_in; engine/cmd/lists.rs move_item | Add, set, remove and reorder solid fill slots on either the selected regions or layer targets, including default slots, colour alpha, independent opacity and visibility. Reuse native paint parsing, model equality, document draft and history. |
| engine/cmd/edit/props.rs paint_copy and paint_paste | Verify active-region copy and mixed rejection. Map solid paint clipboard operations to the same command path. Preserve native paste targeting and clipboard lifetime. |
| engine/canvas/vectoredit/regions_tests.rs the_fill_commands_edit_the_selected_regions and region_fill_edits_apply_once_skip_no_ops_and_copy_the_region | Exercise effective list, no-op inheritance, duplicate targets, invalid requests and atomic undo. Authenticated Chromium must select painted regions, apply colour, opacity, reorder, copy and paste, save and reload. Verify the untouched layer and sibling fills independently. |

The native registry in cmd/edit.rs and cmd/lists.rs defines fill.add, fill.set, fill.remove, fill.move, fill.copy and fill.paste. Default fill is #D9D9D9 for regions and ordinary shapes, white for frame add. Native paste with an index replaces that slot and without an index appends a paint. Region fill changes are local document edits behind the host's existing authenticated editable session. The gradient, image and pattern roadmap owns the remaining paint kinds, native paint frames, assets and renderer integration. The clipboard roadmap owns cross-document layer and stroke behaviour. Preserve those dependencies explicitly through the final audit.

## Execution checkpoint

Phases 1–3. Rollback base 59700e8. Fork, upstream and local submodule at 8a7ebc2484a6d64d80a13c19c18ffb814325e347 after upstream:sync. The scoped Figcraft Supabase MCP returned zero public tables. Local Graphify combines the React graph at 59700e8 and Rust reference into 29,444 nodes and 96,355 edges. Verified selected_region_fills, edit_region_fills and paint_set_in in Rust and AppearancePanel, rectanglePaints and selectVectorParts in React. Optional SQL symbols and Markdown semantics are outside these code graphs. Next implement the six solid fill commands, region resolver and paired behavioural fixtures, then integrate the existing appearance controls, run authenticated browser checks and complete the property report.
