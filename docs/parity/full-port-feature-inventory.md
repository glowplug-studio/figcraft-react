# Full-port upstream feature inventory

Baseline: `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`, inspected 2026-11-06. This document records upstream evidence, not completed implementation.

- [Master plan and resumable checkpoint](../planning/26-11-06-complete-figcraft-port.md)
- [Command inventory](full-port-command-inventory.json)
- [Registry assembly](../../original/figcraft/crates/engine/src/cmd.rs#L73)

No family has complete parity. Families with verified bounded implementations are marked **Partial**; remaining families are **Not implemented / Not tested**. Existing upstream tests identify acceptance cases; they have not been run as React/browser verification. No upstream Rust engine was executed for this inventory.

## Evidence limits

There are 636 unique literal `spec!` declarations in the static command inventory. This is an audit seed, not a runtime completeness claim: direct/generated registrations, catalogue actions, shortcuts, gestures and UI-only paths need separate coverage. `docs/parity-checklist.md` still reports 575 commands and older `docs/target-app-parity.md` reports 449. Historical gap tables sometimes contradict newer implementations. Current source wins.

The upstream advance from `8eb0b876` changed house rules/workflows, not runtime behaviour. Graphify's older index is useful for discovery but cannot supersede the checked-out source. Anchors below are representative entry points, not exhaustive test assertions. Unlisted edge cases and dynamically registered actions remain subject to audit.

## Required feature families

### 1. Documents and native persistence

Status: **Partial**. Bounded persistence, pages, affine/selection and nested-group evidence is linked from the master plan; the remaining properties below are required.

Native archive fidelity, numeric identifiers, embedded images, pages/tabs, home/recent files and thumbnails; dirty state, rename/duplicate/revert; autosave/recovery; version preview/restore/rename/delete/duplicate and branch/version payloads. Preserve older-file compatibility and resource limits. Dependencies: typed document codec, stable identity, browser storage/file adapters and command history.

Implementation anchors: [`file.open`](../../original/figcraft/crates/engine/src/cmd/file.rs#L76), [`file.save`](../../original/figcraft/crates/engine/src/cmd/file.rs#L97), [`file.recover`](../../original/figcraft/crates/engine/src/cmd/file.rs#L181), [`file.versionHistory`](../../original/figcraft/crates/engine/src/cmd/file.rs#L229), [`version.preview`](../../original/figcraft/crates/engine/src/cmd/file.rs#L275), [`page.add`](../../original/figcraft/crates/engine/src/cmd/page.rs#L39), [`doc.home`](../../original/figcraft/crates/engine/src/cmd/file.rs#L349).
Upstream test evidence: [`save_format_tests`](../../original/figcraft/crates/engine/src/save_format_tests.rs#L96), [`save_disk_changes_tests`](../../original/figcraft/crates/engine/src/save_disk_changes_tests.rs#L38), [`autosave_tests`](../../original/figcraft/crates/engine/src/autosave_tests.rs#L20), [`version_tests`](../../original/figcraft/crates/engine/src/version_tests.rs#L21), [`version_preview_tests`](../../original/figcraft/crates/engine/src/version_preview_tests.rs#L30).

### 2. Hierarchy, selection and transforms

Status: **Partial**. Bounded persistence, pages, affine/selection and nested-group evidence is linked from the master plan; the remaining properties below are required.

Shapes/frames/sections/groups/masks; nested hit testing and selection; layer reparenting/order, batch rename; move/resize/rotate/origin/flip; duplicate/repeat; align/distribute/tidy/spacing. Preserve clipping, rotated bounds and nested selection semantics. Dependencies: document model, geometry, command transactions.

Implementation anchors: [`node.create`](../../original/figcraft/crates/engine/src/cmd/create.rs#L59), [`object.group`](../../original/figcraft/crates/engine/src/cmd/structure.rs#L20), [`object.mask`](../../original/figcraft/crates/engine/src/cmd/structure.rs#L59), [`select.all`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L182), [`object.batchRename`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L267), [`transform.rotate`](../../original/figcraft/crates/engine/src/cmd/arrange.rs#L75), [`arrange.tidy`](../../original/figcraft/crates/engine/src/cmd/arrange.rs#L29).
Upstream test evidence: [`transform_behaviour_tests`](../../original/figcraft/crates/engine/src/transform_behaviour_tests.rs#L114), [`frames_behaviour_tests`](../../original/figcraft/crates/engine/src/frames_behaviour_tests.rs#L78), [`rotated_select_tests`](../../original/figcraft/crates/engine/src/rotated_select_tests.rs#L29), [`rotation_origin_tests`](../../original/figcraft/crates/engine/src/rotation_origin_tests.rs#L35), [`selection_reorder_tests`](../../original/figcraft/crates/engine/src/selection_reorder_tests.rs#L13), [`mask_tests`](../../original/figcraft/crates/engine/src/mask_tests.rs#L8).

### 3. Canvas navigation and guides

Status: **Partial**. Viewport/preset evidence: [report](../reports/26-11-07-viewport-parity.html). Remaining grids/guides/preferences/gestures are required.

Pan/zoom, fit/selection/page/frame navigation; rulers/guides/layout and pixel grids; snapping, distance/padding measurement and selection overlays. Dependencies: viewport, geometry, hierarchy, hit testing.

Implementation anchors: [`view.zoomIn`](../../original/figcraft/crates/engine/src/cmd/view.rs#L231), [`view.pan`](../../original/figcraft/crates/engine/src/cmd/view.rs#L291), [`guide.add`](../../original/figcraft/crates/engine/src/cmd/page.rs#L161), [`measure.distances`](../../original/figcraft/crates/engine/src/canvas/distance.rs#L393), [`measure.padding`](../../original/figcraft/crates/engine/src/canvas/distance.rs#L400).
Upstream test evidence: [`view_behaviour_tests`](../../original/figcraft/crates/engine/src/view_behaviour_tests.rs#L95), [`frame_label_tests`](../../original/figcraft/crates/engine/src/frame_label_tests.rs#L38), [`guide_snap_tests`](../../original/figcraft/crates/engine/src/guide_snap_tests.rs#L26).

### 4. Vector authoring and geometry

Status: **Not implemented / Not tested**.

Pen/pencil; vertices/handles/mirroring/smoothing; region selection/painting, cuts/joins and deletion/healing; lasso/transforms; variable-width points; booleans/flatten/outline stroke/winding/offsets; shape-builder region merge/remove and paint preservation. Dependencies: geometry/path operations, renderer, selection and history.

Implementation anchors: [`vector.edit.begin`](../../original/figcraft/crates/engine/src/canvas/vectoredit.rs#L816), [`vector.edit.widthPoint`](../../original/figcraft/crates/engine/src/canvas/vectoredit/width.rs#L244), [`vector.offset`](../../original/figcraft/crates/engine/src/cmd/structure.rs#L154), [`bool.union`](../../original/figcraft/crates/engine/src/cmd/structure.rs#L66), [`shapeBuilder.regions`](../../original/figcraft/crates/engine/src/canvas/shapebuilder.rs#L519).
Upstream test evidence: [`vector_behaviour_tests`](../../original/figcraft/crates/engine/src/vector_behaviour_tests.rs#L20), [`vector_multi_behaviour_tests`](../../original/figcraft/crates/engine/src/vector_multi_behaviour_tests.rs#L96), [`pen_vector_edit_tests`](../../original/figcraft/crates/engine/src/pen_vector_edit_tests.rs#L55), [`vector_offset_tests`](../../original/figcraft/crates/engine/src/vector_offset_tests.rs#L22), [`vector_fill_rule_tests`](../../original/figcraft/crates/engine/src/vector_fill_rule_tests.rs#L145), [`shapebuilder_tests`](../../original/figcraft/crates/engine/src/shapebuilder_tests.rs#L57), [`shapebuilder_strokes_tests`](../../original/figcraft/crates/engine/src/shapebuilder_strokes_tests.rs#L42).

### 5. Paints, images, strokes and effects

Status: **Partial**. Native float colours, rectangle solid-paint stacks and basic layer/page appearance are verified in the [colour report](../reports/26-11-06-solid-colour-parity.html); remaining paint/image/stroke/effect properties below are required.

Ordered fills/strokes/effects; solid/gradient/pattern/image paints; crop/adjustment/presets; blending/masks/pass-through; custom dashes/caps/brush/variable width; shadows/blur/progressive blur/glass/noise/texture. P3 value storage and sRGB proofing do not establish true P3 canvas output. Dependencies: properties, colour, geometry, renderer and resources.

Implementation anchors: [`fill.move`](../../original/figcraft/crates/engine/src/cmd/lists.rs#L18), [`stroke.move`](../../original/figcraft/crates/engine/src/cmd/lists.rs#L21), [`effect.move`](../../original/figcraft/crates/engine/src/cmd/lists.rs#L24), [`fill.pattern`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L355), [`image.adjust`](../../original/figcraft/crates/engine/src/cmd/image.rs#L13), [`image.crop`](../../original/figcraft/crates/engine/src/cmd/image.rs#L44).
Upstream test evidence: [`fx_behaviour_tests`](../../original/figcraft/crates/engine/src/fx_behaviour_tests.rs#L34), [`bound_alpha_tests`](../../original/figcraft/crates/engine/src/bound_alpha_tests.rs#L45), [`dash_cap_tests`](../../original/figcraft/crates/engine/src/dash_cap_tests.rs#L25), [`huge_stroke_tests`](../../original/figcraft/crates/engine/src/huge_stroke_tests.rs#L13).

### 6. Text and fonts

Status: **Not implemented / Not tested**.

Unicode/bidi/graphemes/IME, shaping/fallback and rich runs; lists/links, paragraph settings, wrapping/trim, OpenType/variable fonts, text on paths; live preview, missing-font report/import/download/refit. Dependencies: font resources, measurement/shaping, geometry, renderer and editing transactions.

Implementation anchors: [`text.onPath`](../../original/figcraft/crates/engine/src/cmd/text.rs#L188), [`text.bold`](../../original/figcraft/crates/engine/src/cmd/text.rs#L212), [`text.missingFonts`](../../original/figcraft/crates/engine/src/fonts.rs#L184), [`text.refit`](../../original/figcraft/crates/engine/src/fonts.rs#L191), [`font.download`](../../original/figcraft/crates/engine/src/fonts/download.rs#L146).
Upstream test evidence: [`text_behaviour_tests`](../../original/figcraft/crates/engine/src/text_behaviour_tests.rs#L36), [`text_tail_tests`](../../original/figcraft/crates/engine/src/text_tail_tests.rs#L31), [`text_link_tests`](../../original/figcraft/crates/engine/src/text_link_tests.rs#L11).

### 7. Auto layout and constraints

Status: **Partial**. Frame constraints and bounded resizing verified in the [Frame](../reports/26-11-07-frames-parity.html) and [sizing](../reports/26-11-07-sizing-parity.html) reports; auto layout remains required.

Horizontal/vertical/wrap/grid; hug/fill/fixed, min/max, absolute children and constraints; tracks, alignment/baselines; drag reorder and gap/padding controls; suggested layout. Dependencies: stable text measurement, hierarchy and geometry.

Implementation anchors: [`layout.add`](../../original/figcraft/crates/engine/src/cmd/structure.rs#L73), [`layout.setTrack`](../../original/figcraft/crates/engine/src/cmd/layout.rs#L13), [`layout.suggest`](../../original/figcraft/crates/engine/src/cmd/structure.rs#L112).
Upstream test evidence: [`al_behaviour_tests`](../../original/figcraft/crates/engine/src/al_behaviour_tests.rs#L57), [`al_drag_tests`](../../original/figcraft/crates/engine/src/al_drag_tests.rs#L32), [`auto_layout_move_tests`](../../original/figcraft/crates/engine/src/auto_layout_move_tests.rs#L26).

### 8. Components and instances

Status: **Not implemented / Not tested**.

Components/sets/variants; boolean/text/swap properties, exposed nested properties and slots; instance overrides/reset/push/detach/restore, swapping/cycle prevention, playground and asset placement. Dependencies: hierarchy, layout, identity, styles/variables and propagation.

Implementation anchors: [`component.create`](../../original/figcraft/crates/engine/src/cmd/component.rs#L58), [`component.combineVariants`](../../original/figcraft/crates/engine/src/cmd/component.rs#L75), [`instance.create`](../../original/figcraft/crates/engine/src/cmd/component.rs#L89), [`component.playground`](../../original/figcraft/crates/engine/src/assets/playground.rs#L52).
Upstream test evidence: [`components_scale_tests`](../../original/figcraft/crates/engine/src/components_scale_tests.rs#L73), [`component_cycle_tests`](../../original/figcraft/crates/engine/src/component_cycle_tests.rs#L46), [`nested_override_tests`](../../original/figcraft/crates/engine/src/nested_override_tests.rs#L24), [`slot_tests`](../../original/figcraft/crates/engine/src/slot_tests.rs#L46), [`playground_tests`](../../original/figcraft/crates/engine/src/playground_tests.rs#L54).

### 9. Styles, variables and selection colours

Status: **Not implemented / Not tested**.

Paint/text/effect/grid styles, ordering/folders; typed variables/collections/modes/aliases/scopes/bindings/code syntax; inheritance/extensions/overrides; import/export; selection-colour aggregation/replacement. Dependencies: typed properties, identity/resolution and history.

Implementation anchors: [`style.create`](../../original/figcraft/crates/engine/src/cmd/styles.rs#L31), [`variable.update`](../../original/figcraft/crates/engine/src/cmd/variables.rs#L20), [`variable.import`](../../original/figcraft/crates/engine/src/cmd/variables_io.rs#L25), [`variable.export`](../../original/figcraft/crates/engine/src/cmd/variables_io.rs#L18), [`selection.colors`](../../original/figcraft/crates/engine/src/selection/selection_colors.rs#L119).
Upstream test evidence: [`variable_tests`](../../original/figcraft/crates/engine/src/variable_tests.rs#L39), [`variable_props_tests`](../../original/figcraft/crates/engine/src/variable_props_tests.rs#L36), [`variables_io_tests`](../../original/figcraft/crates/engine/src/variables_io_tests.rs#L44), [`variables_import_shapes_tests`](../../original/figcraft/crates/engine/src/variables_import_shapes_tests.rs#L26), [`library_variables_tests`](../../original/figcraft/crates/engine/src/library_variables_tests.rs#L75).

### 10. Import, export and clipboard

Status: **Not implemented / Not tested**.

Native `.figcraft`; best-effort `.fig` read and experimental write; `.jam` and Sketch import; Penpot import/export; REST JSON plus variables/images; editable SVG; raster/ICC and missing-image warnings. Export PNG/JPEG/WebP/SVG/PDF/Android VectorDrawable with documented options. Clipboard native/design-layer HTML, properties, pages and image resources require independent coverage. Dependencies: relevant model/render/text support, remapped identities, bounded resources and browser APIs.

Implementation anchors: [`file.open`](../../original/figcraft/crates/engine/src/cmd/file.rs#L76), [`file.import`](../../original/figcraft/crates/engine/src/cmd/file.rs#L152), [`file.export`](../../original/figcraft/crates/engine/src/cmd/file.rs#L118), [`file.exportLayers`](../../original/figcraft/crates/engine/src/cmd/file.rs#L125), [`edit.copy`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L118), [`edit.paste`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L120), [`edit.pasteDesignLayers`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L127), [`edit.copyProperties`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L136), [`edit.pasteProperties`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L137).
Upstream test evidence: [`import_export_tests`](../../original/figcraft/crates/engine/src/import_export_tests.rs#L58), [`fig_import_tests`](../../original/figcraft/crates/engine/src/fig_import_tests.rs#L10), [`sketch_import_tests`](../../original/figcraft/crates/engine/src/sketch_import_tests.rs#L63), [`svg_import_tests`](../../original/figcraft/crates/engine/src/svg_import_tests.rs#L16), [`vector_drawable_export_tests`](../../original/figcraft/crates/engine/src/vector_drawable_export_tests.rs#L30), [`page_clipboard_tests`](../../original/figcraft/crates/engine/src/page_clipboard_tests.rs#L8), [`import_journal_tests`](../../original/figcraft/crates/engine/src/import_journal_tests.rs#L19), [`web_clipboard_tests`](../../original/figcraft/crates/ui-egui/src/web_clipboard_tests.rs#L122), [`clipboard_fence_tests`](../../original/figcraft/crates/ui-egui/src/clipboard_fence_tests.rs#L92).

### 11. Comments

Status: **Not implemented / Not tested**.

Anchored pins/threads/replies, edits/reactions/resolution, mentions/unread/filter/navigation/links; authenticated principal mapping with compatible author strings and agent labels. Dependencies: persistent documents, stable anchors, identity/access and shared updates.

Implementation anchors: [`comment.add`](../../original/figcraft/crates/engine/src/cmd/comment.rs#L670), [`comment.reply`](../../original/figcraft/crates/engine/src/cmd/comment.rs#L704), [`comment.react`](../../original/figcraft/crates/engine/src/cmd/comment.rs#L732), [`comment.resolve`](../../original/figcraft/crates/engine/src/cmd/comment.rs#L757), [`comment.markRead`](../../original/figcraft/crates/engine/src/cmd/comment.rs#L807).
Upstream test evidence: [`comments_tests`](../../original/figcraft/crates/ui-egui/src/comments_tests.rs#L47), [`comment_mentions_tests`](../../original/figcraft/crates/engine/src/comment_mentions_tests.rs#L15), [`comments_polish_tests`](../../original/figcraft/crates/engine/src/comments_polish_tests.rs#L28), [`comment_agent_tests`](../../original/figcraft/crates/engine/src/comment_agent_tests.rs#L19).

### 12. Versions and branches

Status: **Not implemented / Not tested**.

Version history is distinct from undo. Branch create/list/open/review/update-from-main/merge/archive; property/list-aware three-way conflicts and branch-local histories. Restoration preserves applicable comments and newer history. Dependencies: durable snapshots, identity, structured diff/merge and permissions.

Implementation anchors: [`branch.create`](../../original/figcraft/crates/engine/src/sharing/branches.rs#L35), [`branch.review`](../../original/figcraft/crates/engine/src/sharing/branches.rs#L54), [`branch.updateFromMain`](../../original/figcraft/crates/engine/src/sharing/branches.rs#L61), [`branch.merge`](../../original/figcraft/crates/engine/src/sharing/branches.rs#L68), [`branch.archive`](../../original/figcraft/crates/engine/src/sharing/branches.rs#L75), [`version.restore`](../../original/figcraft/crates/engine/src/cmd/file.rs#L241).
Upstream test evidence: [`branch_tests`](../../original/figcraft/crates/engine/src/branch_tests.rs#L31), [`branch_versions_tests`](../../original/figcraft/crates/engine/src/branch_versions_tests.rs#L34), [`branch_live_tests`](../../original/figcraft/crates/engine/src/branch_live_tests.rs#L38), [`version_tests`](../../original/figcraft/crates/engine/src/version_tests.rs#L21), [`branch_ui_tests`](../../original/figcraft/crates/ui-egui/src/branch_ui_tests.rs#L12).

### 13. Online files, sharing and live collaboration

Status: **Not implemented / Not tested**.

Online file list/open/forget/recover; publish/share with view/comment/edit grants, revocation/expiry; join progress/cancel/retry and moderation/reporting. Ordered authoritative changes, optimistic rollback/reconciliation, reconnect/offline handling, bounded identifiers/logs/tombstones, per-client undo. Cursors/selections/carets/avatars/follow/chat/spotlight. Dependencies: authenticated ownership, RLS/Storage grants, stable commands/identity, persistence and transport adapters.

Implementation anchors: [`collab.files`](../../original/figcraft/crates/engine/src/sharing/online.rs#L627), [`collab.openFile`](../../original/figcraft/crates/engine/src/sharing/online.rs#L634), [`collab.recoverFile`](../../original/figcraft/crates/engine/src/sharing/online.rs#L648), [`collab.host`](../../original/figcraft/crates/engine/src/sharing/live/join.rs#L167), [`collab.share`](../../original/figcraft/crates/engine/src/sharing/live/join.rs#L174), [`collab.join`](../../original/figcraft/crates/engine/src/sharing/live/join.rs#L188), [`collab.diff`](../../original/figcraft/crates/engine/src/sharing/collab.rs#L27).
Upstream test evidence: [`collab_ids_tests`](../../original/figcraft/crates/engine/src/collab_ids_tests.rs#L25), [`live_peer_cap_tests`](../../original/figcraft/crates/engine/src/live_peer_cap_tests.rs#L14), [`live_signal_tests`](../../original/figcraft/crates/engine/src/live_signal_tests.rs#L34), [`agent_presence_tests`](../../original/figcraft/crates/engine/src/agent_presence_tests.rs#L20).

### 14. Libraries and assets

Status: **Not implemented / Not tested**.

Local/server discovery, publish/revisions and update checks; accepting updates preserves overrides; component/style/variable import/extensions, whole-library swapping and usage/insertion/detach analytics with time ranges. Dependencies: components/styles/variables, revision identity, permissions/resources.

Implementation anchors: [`library.publish`](../../original/figcraft/crates/engine/src/cmd/library.rs#L32), [`library.add`](../../original/figcraft/crates/engine/src/cmd/library.rs#L53), [`library.list`](../../original/figcraft/crates/engine/src/cmd/library.rs#L39), [`libraries.publish`](../../original/figcraft/crates/engine/src/cmd/library.rs#L28).
Upstream test evidence: [`library_variables_tests`](../../original/figcraft/crates/engine/src/library_variables_tests.rs#L75), [`library_range_styles_tests`](../../original/figcraft/crates/engine/src/library_range_styles_tests.rs#L34), [`library_beacon_tests`](../../original/figcraft/crates/engine/src/library_beacon_tests.rs#L80).

### 15. Prototyping and presentation

Status: **Not implemented / Not tested**.

Flows/triggers including keyboard/gamepad/hover/drag/delay; ordered/conditional actions and variables; navigation/back/overlays/scroll; responsive presentation and anchored/manual overlays, smart animation/springs, interactive components/GIF playback; preview/options/link notices. Dependencies: scene/layout/components, evaluation, rendering and input.

Implementation anchors: [`proto.interaction.add`](../../original/figcraft/crates/engine/src/cmd/proto.rs#L16), [`proto.flow.add`](../../original/figcraft/crates/engine/src/cmd/proto.rs#L58), [`proto.action.add`](../../original/figcraft/crates/engine/src/cmd/proto_actions.rs#L28), [`proto.conditional.addBlock`](../../original/figcraft/crates/engine/src/cmd/proto_actions.rs#L50).
Upstream test evidence: [`proto_behaviour_tests`](../../original/figcraft/crates/engine/src/proto_behaviour_tests.rs#L23), [`proto_run_tests`](../../original/figcraft/crates/engine/src/proto_run_tests.rs#L49), [`proto_conditional_tests`](../../original/figcraft/crates/engine/src/proto_conditional_tests.rs#L48), [`proto_multi_tests`](../../original/figcraft/crates/engine/src/proto_multi_tests.rs#L8), [`proto_delay_tests`](../../original/figcraft/crates/engine/src/proto_delay_tests.rs#L19), [`proto_overlay_anchor_tests`](../../original/figcraft/crates/engine/src/proto_overlay_anchor_tests.rs#L30), [`proto_responsive_tests`](../../original/figcraft/crates/engine/src/proto_responsive_tests.rs#L43), [`proto_present_tests`](../../original/figcraft/crates/engine/src/proto_present_tests.rs#L19).

### 16. Dev Mode and generated code

Status: **Not implemented / Not tested**.

Read-only guards; property/style/variable/unit inspection. Ten `inspect.code` targets: CSS, HTML, React, Leptos, Vue, Tailwind, SwiftUI, Compose, ArkUI, Flutter. Component properties/playground; Code Connect mappings/templates/imports; annotations/categories/resource links/measurements; ready/changed/completed state, focus and version comparisons. Dependencies: inspected model, components/variables, code generation, history and mode guards.

Implementation anchors: [`inspect.code`](../../original/figcraft/crates/engine/src/dev/codegen.rs#L41), [`inspect.componentCode`](../../original/figcraft/crates/engine/src/dev/component_codegen.rs#L70), [`inspect.properties`](../../original/figcraft/crates/engine/src/dev/devinspect.rs#L318), [`codeConnect.set`](../../original/figcraft/crates/engine/src/dev/code_connect.rs#L558), [`annotation.add`](../../original/figcraft/crates/engine/src/dev/annotations.rs#L247), [`devResource.add`](../../original/figcraft/crates/engine/src/dev/dev_resources.rs#L144), [`devMode.addMeasurement`](../../original/figcraft/crates/engine/src/dev/dev_measurements.rs#L200), [`dev.compare`](../../original/figcraft/crates/engine/src/cmd/section.rs#L34), [`dev.focus`](../../original/figcraft/crates/engine/src/cmd/section.rs#L41).
Upstream test evidence: [`devinspect_tests`](../../original/figcraft/crates/engine/src/devinspect_tests.rs#L19), [`devmode_behaviour_tests`](../../original/figcraft/crates/engine/src/devmode_behaviour_tests.rs#L41), [`devcompare_tests`](../../original/figcraft/crates/engine/src/devcompare_tests.rs#L40), [`devfocus_tests`](../../original/figcraft/crates/engine/src/devfocus_tests.rs#L24), [`dev_resources_tests`](../../original/figcraft/crates/engine/src/dev_resources_tests.rs#L24), [`dev_measurements_tests`](../../original/figcraft/crates/engine/src/dev_measurements_tests.rs#L43), [`dev_mode_tests`](../../original/figcraft/crates/ui-egui/src/dev_mode_tests.rs#L29).

### 17. Boards and facilitation

Status: **Not implemented / Not tested**.

Board documents/tool mode/grid styles; 23 shape choices, editable/autosizing stickies/connected creation; straight/elbow/curved connectors with attachment/reshape/labels/rerouting; stamps/marker/highlighter/eraser; tables/TSV paste; five templates; shared timer and scoped voting/limits/ranking/result history. Dependencies: scene/text, routing/hit testing, metadata and shared transport.

Implementation anchors: [`board.sticky`](../../original/figcraft/crates/engine/src/boards/board.rs#L100), [`board.shape`](../../original/figcraft/crates/engine/src/boards/board.rs#L121), [`board.connector`](../../original/figcraft/crates/engine/src/boards/board.rs#L128), [`board.reattach`](../../original/figcraft/crates/engine/src/boards/board.rs#L135), [`board.reshape`](../../original/figcraft/crates/engine/src/boards/board.rs#L142), [`board.table`](../../original/figcraft/crates/engine/src/boards/board_table.rs#L34), [`board.tableEdit`](../../original/figcraft/crates/engine/src/boards/board_table.rs#L41), [`board.template`](../../original/figcraft/crates/engine/src/boards/board_templates.rs#L67), [`board.grid`](../../original/figcraft/crates/engine/src/boards/board_grid.rs#L131), [`board.timer`](../../original/figcraft/crates/engine/src/cmd/facilitate.rs#L31), [`board.vote`](../../original/figcraft/crates/engine/src/cmd/facilitate.rs#L48).
Upstream test evidence: [`board_tests`](../../original/figcraft/crates/engine/src/board_tests.rs#L48), [`board_tools_tests`](../../original/figcraft/crates/engine/src/board_tools_tests.rs#L23), [`board_connected_tests`](../../original/figcraft/crates/engine/src/board_connected_tests.rs#L23), [`board_connector_tests`](../../original/figcraft/crates/engine/src/board_connector_tests.rs#L24), [`board_reshape_tests`](../../original/figcraft/crates/engine/src/board_reshape_tests.rs#L46), [`board_tables_tests`](../../original/figcraft/crates/engine/src/board_tables_tests.rs#L36), [`board_table_paste_tests`](../../original/figcraft/crates/engine/src/board_table_paste_tests.rs#L19), [`board_grid_tests`](../../original/figcraft/crates/engine/src/board_grid_tests.rs#L9), [`facilitate_tests`](../../original/figcraft/crates/engine/src/facilitate_tests.rs#L23), [`vote_history_tests`](../../original/figcraft/crates/engine/src/vote_history_tests.rs#L44), [`board_ui_tests`](../../original/figcraft/crates/ui-egui/src/board_ui_tests.rs#L70).

### 18. Plugins and widgets

Status: **Not implemented / Not tested**.

WASM ABI v6 import/run/remove; permissions/fuel/memory/log limits; transactional callback rollback; panels/controls/settings/images/save-file callbacks and read-only Dev Mode guards. Widget scene/state/text/menu/hover/SVG/lines and panel callbacks. Directory network operations require a separate supported-host audit. Dependencies: command/model ABI, bounded resources, history and accessible UI.

Implementation anchors: [`plugin.list`](../../original/figcraft/crates/engine/src/extensions/plugins.rs#L665), [`plugin.import`](../../original/figcraft/crates/engine/src/extensions/plugins.rs#L666), [`plugin.run`](../../original/figcraft/crates/engine/src/extensions/plugins.rs#L674), [`plugin.ui`](../../original/figcraft/crates/engine/src/extensions/plugins.rs#L681), [`plugin.directory.list`](../../original/figcraft/crates/engine/src/extensions/plugin_directory.rs#L288), [`widget.insert`](../../original/figcraft/crates/engine/src/extensions/widgets.rs#L565), [`widget.click`](../../original/figcraft/crates/engine/src/extensions/widgets.rs#L572), [`widget.setText`](../../original/figcraft/crates/engine/src/extensions/widgets.rs#L579), [`widget.menu`](../../original/figcraft/crates/engine/src/extensions/widgets.rs#L586), [`widget.hover`](../../original/figcraft/crates/engine/src/extensions/widgets.rs#L593).
Upstream test evidence: [`plugins_tests`](../../original/figcraft/crates/engine/src/plugins_tests.rs#L103), [`plugin_panels_tests`](../../original/figcraft/crates/engine/src/plugin_panels_tests.rs#L119), [`plugin_data_tests`](../../original/figcraft/crates/engine/src/plugin_data_tests.rs#L9), [`plugin_directory_tests`](../../original/figcraft/crates/engine/src/plugin_directory_tests.rs#L128), [`widgets_tests`](../../original/figcraft/crates/engine/src/widgets_tests.rs#L160), [`widget_input_tests`](../../original/figcraft/crates/engine/src/widget_input_tests.rs#L60), [`widget_shapes_tests`](../../original/figcraft/crates/engine/src/widget_shapes_tests.rs#L46), [`widget_hover_tests`](../../original/figcraft/crates/engine/src/widget_hover_tests.rs#L53), [`widget_panel_tests`](../../original/figcraft/crates/engine/src/widget_panel_tests.rs#L53).

### 19. Templates, data filling and text fitting

Status: **Not implemented / Not tested**.

Eight starter templates and theme-aware home previews; board templates are separate. `data.fill` and `text.fit` are landed utility commands, not speculative AI features. Dependencies: document construction, assets, selection and reliable text measurement.

Implementation anchors: [`template.list`](../../original/figcraft/crates/engine/src/content/templates.rs#L182), [`file.newFromTemplate`](../../original/figcraft/crates/engine/src/content/templates.rs#L189), [`data.fill`](../../original/figcraft/crates/engine/src/content/datafill.rs#L17), [`text.fit`](../../original/figcraft/crates/engine/src/content/textfit.rs#L18).
Upstream test evidence: [`templates_tests`](../../original/figcraft/crates/engine/src/templates_tests.rs#L28), [`datafill_tests`](../../original/figcraft/crates/engine/src/datafill_tests.rs#L31), [`textfit_tests`](../../original/figcraft/crates/engine/src/textfit_tests.rs#L24).

### 20. Chrome, preferences, accessibility and localisation

Status: **Not implemented / Not tested**.

Tabs/header/panels/layers/assets/bottom toolbars/flyouts; Design/Prototype/Inspect; persisted panel widths/collapse; menus/context menus/ranked palette/shortcuts; colour-picker models and field arithmetic; theme/UI scale/nudge/autosave/user name/preferences. Semantic controls, keyboard regions, reduced motion/contrast; catalogue overlays/fallback/plurals/language switching. Dependencies span every visible feature; do not defer basic accessibility to final publication.

Implementation anchors: [`view.layers`](../../original/figcraft/crates/engine/src/cmd/view.rs#L335), [`view.assets`](../../original/figcraft/crates/engine/src/cmd/view.rs#L336), [`pref.language`](../../original/figcraft/crates/engine/src/cmd/view.rs#L480), [`pref.uiScale`](../../original/figcraft/crates/engine/src/cmd/view.rs#L404), [`pref.autoSave`](../../original/figcraft/crates/engine/src/cmd/view.rs#L436), [`pref.nudge`](../../original/figcraft/crates/engine/src/cmd/view.rs#L438).
Upstream test evidence: [`keymap_tests`](../../original/figcraft/crates/engine/src/keymap_tests.rs#L32), [`shortcut_parity_tests`](../../original/figcraft/crates/engine/src/shortcut_parity_tests.rs#L351), [`view_behaviour_tests`](../../original/figcraft/crates/engine/src/view_behaviour_tests.rs#L95), [`layers_keyboard_tests`](../../original/figcraft/crates/ui-egui/src/layers_keyboard_tests.rs#L63), [`context_menu_tests`](../../original/figcraft/crates/ui-egui/src/context_menu_tests.rs#L26), [`palette_tests`](../../original/figcraft/crates/ui-egui/src/palette_tests.rs#L12), [`shortcut_keys_tests`](../../original/figcraft/crates/ui-egui/src/shortcut_keys_tests.rs#L39), [`theme_startup_tests`](../../original/figcraft/crates/ui-egui/src/theme_startup_tests.rs#L14), [`ui_scale_tests`](../../original/figcraft/crates/ui-egui/src/ui_scale_tests.rs#L31).

Also audit `crates/ui-egui/src/{app,state,toolbar,menus,dialogs,panels,widgets,a11y,i18n,theme,prefs}`, engine keymaps/catalogue and UI `i18n/tests.rs`. The engine command surface alone cannot establish UI parity.

### 21. Command transactions and validation

Status: **Partial**. Bounded persistence, pages, affine/selection and nested-group evidence is linked from the master plan; the remaining properties below are required.

Query versus history mutations; document routing; deterministic IDs/order; unknown-parameter rejection. Batch grouped undo, step references, error continuation and atomic/panic rollback. Clipboard/import must use the same transaction/identity boundaries. Dependencies: foundational document/history/identity contracts, before composing the other families.

Implementation anchors: [`command.batch`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L464), [`edit.undo`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L108), [`edit.redo`](../../original/figcraft/crates/engine/src/cmd/edit.rs#L109), [`doc.list`](../../original/figcraft/crates/engine/src/cmd/file.rs#L326).
Upstream test evidence: [`batch_rollback_tests`](../../original/figcraft/crates/engine/src/batch_rollback_tests.rs#L10), [`batch_step_ref_tests`](../../original/figcraft/crates/engine/src/batch_step_ref_tests.rs#L9), [`batch_continue_events_tests`](../../original/figcraft/crates/engine/src/batch_continue_events_tests.rs#L10), [`batch_undo_snapshot_tests`](../../original/figcraft/crates/engine/src/batch_undo_snapshot_tests.rs#L24), [`group_panic_tests`](../../original/figcraft/crates/engine/src/group_panic_tests.rs#L20), [`unknown_params_tests`](../../original/figcraft/crates/engine/src/unknown_params_tests.rs#L17), [`id_params_behaviour_tests`](../../original/figcraft/crates/engine/src/id_params_behaviour_tests.rs#L39), [`doc_list_paths_tests`](../../original/figcraft/crates/engine/src/doc_list_paths_tests.rs#L19).

## Dependency ordering and checkpoints

1. Document/model/codec, identity, ownership, history and validated transactions.
2. Geometry/renderer/hierarchy/selection/viewport, then complete shapes/vectors/paints.
3. Text/fonts/layout, then components/styles/variables/import-export and templates/utilities.
4. Durable histories and authenticated ordered sharing, then comments/collaboration/libraries/branches.
5. Prototyping, Dev Mode, Boards and plugins/widgets, each with its own feature matrix.
6. Cross-family persistence/round trips, multi-client permissions/reconnect, error/rollback, keyboard/accessibility/localisation and performance; final hosted publication gates from the master prompt.

Slices are resumable execution units, not completion boundaries. Add newly discovered landed behaviour to the master matrix. Before completion, reconcile every command/catalogue item/shortcut, relevant format/resource and observable UI path against implementation and actual browser evidence. Upstream test existence is never a port pass.

## Native-only exclusions and browser equivalents

- OS title-bar controls/drag regions/window placement/multiple native windows are platform mechanics. Browser tabs, navigation, panel behaviour and fullscreen remain required. Evidence: [view/window commands](../../original/figcraft/crates/engine/src/cmd/view.rs), [UI parity](../../original/figcraft/docs/ui-parity.md).
- Executable packaging/updating/signing, native tray/process lifecycle, shell completion/manpages, daemon/TCP/stdio MCP hosting and OS protocol registration are native hosting concerns. Preserve browser links and equivalent command behaviour. Evidence: [link registration](../../original/figcraft/crates/engine/src/sharing/invite_links.rs).
- Finder/reveal actions, unrestricted directory traversal and atomic filesystem rename require browser picker/download/storage equivalents. Save integrity/recovery/resource limits/error behaviour remain required. Evidence: [file commands](../../original/figcraft/crates/engine/src/cmd/file.rs), [browser recovery](../../original/figcraft/apps/figcraft-web/src/recovery.rs).
- OS font-registry scanning requires browser font access/import/fallback equivalents. Missing-font handling and document fidelity remain required. Evidence: [font commands](../../original/figcraft/crates/engine/src/fonts.rs).
- Metal/Vulkan/DX/winit details are implementation mechanics. Equivalent browser rendering, input and frame-frequency performance remain required.
- Plugin WASM is not automatically excluded: upstream has browser plugin behaviour. Independently hosting bounded user plugin ABI is distinct from importing/executing the prohibited Rust application engine. Audit browser directory/network restrictions explicitly. Evidence: [plugin ABI and host limits](../../original/figcraft/docs/plugins.md).

## Upstream gaps are not speculative port requirements

Do not invent hypothetical Figma features: AI product features, audio/huddles, HEIC/video/deck support, Figma JavaScript plugin compatibility and true P3 canvas output are not claimed as landed requirements here. Each exclusion still needs current-source checking if implementation evidence emerges. In particular, old Boards and import gap rows must not hide newer implemented features.

## Verified bounded additions — 7 November 2026

Frames/constraints: [property report](../reports/26-11-07-frames-parity.html). Viewport/presets: [property report](../reports/26-11-07-viewport-parity.html). Movement/alignment/distribution/stacking: [property report](../reports/26-11-07-arrangement-parity.html). No complete family is passed; advanced layout, all unsupported kinds and remaining interaction/UI properties are still required.

Anchored resizing and uniform scaling: [property report](../reports/26-11-07-sizing-parity.html).

Rotation origins and numeric transforms: [property report](../reports/26-11-07-rotation-parity.html).

Smart-selection tracks, reordering and transient gestures: [property report](../reports/26-11-07-smart-selection-parity.html).
