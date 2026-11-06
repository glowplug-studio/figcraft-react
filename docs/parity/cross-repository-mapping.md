# Cross-repository mapping

Graphify indexes `glowplug-studio/figcraft` and `glowplug-studio/figcraft-react` independently. It does not automatically determine which Rust and TypeScript symbols are equivalent.

Add mappings only after inspecting behaviour, callers, data contracts and tests. Preserve upstream command identifiers, file-format keys and user-facing terminology where they are compatibility contracts; otherwise use idiomatic TypeScript names and record the relationship here.

| Port scope | Upstream Rust module or symbol | Upstream evidence | TypeScript target | Parity tests | Status |
|---|---|---|---|---|---|
| Local document | `doc::Document::new`, `Node::new`, `NodeKind::{Page,Rectangle}` | `doc/src/lib.rs`, `doc/src/node.rs`, `color/src/lib.rs`; default page/name/fill | `src/engine/document.ts`, rectangle constructor in `editor.ts` | `tests/parity/rectangle.test.ts` defaults and paired create test | Verified page/rectangle subset; native codec mapped below |
| Rectangle command/history | `cmd::create::create`, `shape.rectangle`; `create_select_undo_redo` | Registry label/undo flag; Rust x=10,y=20,w=30,h=40 test | `EditorEngine.execute` | `rectangle.test.ts`; `preview.spec.ts` authenticated command/keyboard test | Verified supported parameters; props/other kinds explicitly rejected |
| Drawing gesture | `Session::draw_drag`, `Session::up`, `ToolId::click_size` | Reverse extents, Shift/Alt, pixel rounding, tiny-click 100x100, return to Move | `drawnRectangle`, `CanvasController` | `rectangle.test.ts` geometry; `preview.spec.ts` pointer test | Verified page-only subset; object snapping deferred |
| Solid rectangle rendering | `render_one`, ordered page children, `Node::new` colours | `render/src/lib.rs`, `doc/src/node.rs`, `color/src/lib.rs` | `renderDocument` | Browser pixel test, canvas screenshot and 10,000-node fixture | Verified flat solid rectangle subset |
| Host identity boundary | Upstream has no accounts; local file editing independent of online owner tokens | `access-mapping.md`, `Document::new`; host requirement in execution prompt | Next.js host and `SupabaseIdentityAdapter`; existing read/edit capabilities | Shared contracts, real Auth integration, browser login/refresh/logout | Host infrastructure verified locally; no new product role |
| Native file envelope and IDs | `format::{DocumentJson,to_json,from_json,load_limited}`, `doc::NodeId` | Native format/version, lossless u64 numbers, document.json ZIP member | `src/engine/file-format.ts` | `file-format.test.ts` (41 cases), browser native download/reopen | Verified page/rectangle subset; resources and other properties explicitly refused |
| Snapshot save/open | `cmd/file/save::{FileSnapshot,save_to,mark_saved}`, browser data open | Captured revision acknowledgement; errors leave document unchanged | `EditorEngine.executeAsync`, file acknowledgement | `file-commands.test.ts` (10 cases), browser native round-trip | Verified bounded single-document workflow; workspace tabs remain required |
| Browser recovery | `apps/figcraft-web/recovery::{Unsaved,store,restore}` | Unsaved restoration, successful-write acknowledgement | `RecoveryStore`, `IndexedDbRecoveryStore`, `RecoveryController` | Recovery contract (8), controller (10), browser reload/storage-denial | Verified local principal-scoped storage; no online file claim |
| Page lifecycle | `cmd/page.rs::{page.add,select,rename,delete,duplicate,move,list}`, `doc::is_divider` | `panels_behaviour_tests`, `page_target_tests`, supported `theme_pages_tests` | `src/engine/pages.ts`, `PagePanel`, engine transaction integration | `pages.test.ts` (49), `page-history.test.ts` (5), authenticated page browser flows | Verified page/rectangle subset; guides, prototype remapping and viewport fit remain dependencies |
| Affine geometry | `geom/src/transform.rs`, Kurbo coefficient convention | Upstream rotation/centre/flip fixtures and independent algebra | `src/engine/affine.ts`, optional rectangle transform bridge | `affine.test.ts`, affine codec/transaction tests, browser rotation pixels/reload | Verified affine rectangle subset; full shared-node schema remains required |
| Geometry properties | `cmd/edit/props.rs::set`, `cmd/props.rs::apply_geometry` | Size → rotation → X/Y order; atomic target/value checks | `src/engine/properties.ts`, inspector and engine history | `rectangle-properties.test.ts`, `transform-history.test.ts`, browser geometry workflow | Partial node.set: geometry and basic solid appearance; no moved rotation origin or container/layout semantics |
| Flat selection and hit testing | `cmd/edit.rs` select commands, `doc_state::clean_selection`, native geometry hit intent | Page switch/cleanup; frontmost transformed rectangle | `src/engine/selection.ts`, CanvasController, layer controls | `selection.test.ts`, transformed browser pointer selection | Verified supported flat boxes; nested/marquee and gesture semantics remain required |
| Native colour | `color::{Color,ColorRepr}`, `hsx`, `lch`, `named` | Native f32 channels, CSS/hex/name parsing, source conversion fixtures | `colour.ts`, `colour-css.ts`, `colour-spaces.ts`, `colour-names.ts` | `colour-css.test.ts`, `colour-spaces.test.ts`, native file and browser colour flows | Verified supported colour values; full profile/picker workflows remain required |
| Solid paints and layer appearance | `Paint::solid/solid_color`, `cmd/props.rs`, `render::fill_with` | Typed alpha metadata, ordered fills, layer isolation, top-first paint panel | `solid-paint.ts`, document/codec/properties, Canvas 2D and AppearancePanel | `solid-paints.test.ts`, `appearance-properties.test.ts`, file-format and browser compositing checks | Verified rectangle solid-paint subset; other paints, blending/effects and complete UI remain required |
| Page colour | `cmd/page.rs::page.setBackground` | Colour parsing, current/explicit page target, inherited background | `pages.ts`, AppearancePanel, native/recovery codec | Page/history tests and transparent-background browser test | Verified current typed page model |
| Nested groups and structure | `doc::{world_transform,frame_relative,reparent,fit_to_children}`, `cmd/structure::{wrap,ungroup}`, `cmd/edit/props::reparent` | Group bounds, world preservation, final index and empty cleanup; frames behaviour tests | `hierarchy.ts`, `structure.ts`, engine/property integration | `hierarchy*.test.ts`, `structure.test.ts`, three group browser workflows | Verified bounded Group/Rectangle hierarchy; Frames and other kinds remain required |
| Nested rendering and selection | `render::render_one`, `geometry::{select_target,level_target}`, selection commands | Group children-only paint, isolated opacity, sibling/deep context | Canvas renderer/cache, `selection.ts`, `LayerPanel` | Pure hierarchy selection, browser compositing/mobile/recovery, 10k nested fixture | Verified bounded solid group subset; full gestures and layer UI remain required |
| Frame containers and conversion | `Node::new(Frame)`, `cmd/structure::{wrap,convert,ungroup}`, `geometry::level_target` | Frame defaults, clipping, conversion and artboard picking | Frame model/codec/structure/canvas/selection and React controls | `frames.test.ts`, two frame browser flows | Verified bounded solid Frame workflow; presets/gestures/layout remain required |
| Child constraints | `layout::{apply_constraints,scale_group_children,axis_factors}`, `cmd/props::resize_node` | Five constraints per axis, rotated dimensions and iterative nesting | `constraints.ts`, `properties.ts` | 10 mode cases, nested/rotated/group fixtures and browser right-pin/undo | Verified supported Frame/Group/Rectangle nodes; other kinds remain required |

## Viewport and presets — 7 November 2026

`view_state.rs::{origin,set_zoom_at,fit,scroll,page_to_screen,screen_to_page}` → `engine/viewport.ts`; `cmd/view.rs` zoom/navigation specs → `executeView` and separate EditorEngine view subscriptions; egui canvas input → captured CanvasController pan/wheel/Z input; `cmd/create.rs::FRAME_PRESETS` and free placement → `frame-presets.ts`. Source0b97f3f, Reactd0fae6c. Pure numeric fixtures plus authenticated Chromium verify supported behaviour; full state flags/preferences/direct touch/other kinds remain required. [Property evidence](../reports/26-11-07-viewport-parity.html).

## Movement and arrangement — 7 November 2026

`cmd/arrange::{move_world,align,distribute,pack,tidy,zorder}` and `cmd/edit/select::nudge` → `engine/arrange.ts` with immutable HierarchyDraft; native `req_targets` → strict arrangement target parsing; EditorEngine history and ArrangePanel dispatch preserve atomicity. Upstream0b97f3f, React783a694.331 pure/30 browser suite passes include source-derived outermost-edge and multi-parent cases. [Property evidence](../reports/26-11-07-arrangement-parity.html). Nudge local axes intentionally differ from page-space move. Auto-layout/preferences/other kinds remain incomplete.

## Anchored resize and uniform scale — 7 November 2026

`cmd/arrange::{resize_cmd,scale_cmd,scale_node}`, `cmd/edit/select::nudge_size` and `handles::anchor_of` → `engine/sizing.ts`, shared arrangement targets and constraints, EditorEngine/SizePanel. Upstream0b97f3f, Reactc6b8c71. Source-derived nine-anchor, ordered target, rotated subtree, finite/atomic and codec fixtures plus authenticated keyboard/pivot/recovery/browser checks pass. [Property evidence](../reports/26-11-07-sizing-parity.html). Other kinds, scaling properties, preferences, layout and pointer tools remain required.

## Rotation origins and transforms — 7 November 2026

`canvas/rotation_origin.rs` and `tools/handles::{selection_frame,shared_rotation}` → `rotation.ts` and independent origin subscriptions; `cmd/arrange::{flip,rotate_by,turn_pivot}` → pure rotation reducer; `cmd/edit/props::set` pinning → properties reducer; native pointer/overlays → CanvasController ring/cross and RotationPanel. Upstream0b97f3f, React92062ca.365 pure/34 browser passes include native pivot fixtures, lifecycle, real pointer/keyboard, no root rerender and persistence. [Property evidence](../reports/26-11-07-rotation-parity.html). Other kinds, vector/text mode and general transform gestures remain required.

## Smart selection — 7 November 2026

`selection_spacing::{selection_spacing,axis,Axis::offsets}` and `selection_reorder::ReorderLayout` → `smart-selection.ts`; `cmd/arrange::{spacing,reorder,round_px}` → immutable smart reducer; native interaction snapshots → EditorEngine transient render document; `ui-egui/canvas/selection_spacing` and numeric label scrubs → SmartHandles/SmartSelectionPanel. Upstream0b97f3f, React3326d26.379 pure/38 browser checks pass, including source grids/reflow/cancellation and10000-node preview benchmark. [Property evidence](../reports/26-11-07-smart-selection-parity.html). Auto-layout/instances, field arithmetic/preferences and multi-file ownership remain required.

## Layer duplication — 7 November 2026

`cmd/edit::{Duplicated,duplicate}`, `doc::Document::{duplicate_into,paste_nodes}`, `components::copy_in_file` and selection cleanup → `engine/duplicate.ts`, EditorEngine session state and immutable hierarchy copying; primary+D → Editor/LayerPanel. Upstream0b97f3f, Reactf6dfc3f.391 pure/40 browser checks include exact maps, offsets, atomic allocation, source preservation, keyboard/mobile/native recovery. [Property evidence](../reports/26-11-07-duplication-parity.html). Explicit offsets follow parent-space native implementation. Other kinds/reference remapping, preferences and Alt-drag remain required.

## Canvas selection and movement — 7 November 2026

`tools/drag::{move_down,drag}`, `draw::up`, pointer marquee and document hit selection → `MoveInteraction`, `canvas-selection.ts` and extended EditorEngine transient selection/allocation. `canvas/snap::Targets`, drop and distance helpers → `snapping.ts`, `measurements.ts`. Upstream0b97f3f, React0d34280.418 pure/46 browser checks verify contextual selection, move/modifiers, Alt-copy repeat, Frame parenting, guide geometry, native recovery and10000-node preview performance. [Property evidence](../reports/26-11-07-canvas-move-parity.html). Other kinds/layout/preferences/labels and remaining transforms continue on the roadmap.

## Pointer transforms and Scale tool — 7 November 2026

`tools/handles::{handle_at_corners,resized_box,scale_factor}` → `transform-handles.ts`; `tools/drag::{resize_drag,scale_drag}` and Rotate → `transform-preview.ts` / `TransformInteraction`; native scale panel → `ScalePanel`; source proportions property → properties/codec. `theme::{set_canvas_page,under_white}` → canvas-colours and shared overlays, correcting prior blue outlines. Upstream0b97f3f, Reactcc26af1.440 pure/52 browser checks pass, including source multi-rotation/anchor fixtures, Frame/keyboard/persistence/mobile and10000-node previews. [Property evidence](../reports/26-11-07-transform-handles-parity.html). Other kinds/scaled properties/layout/preferences and custom cursor artwork remain required.


## Rounded corners and radius handles (0.17.0)

| Upstream symbol/source | React target | Behavioural evidence and verification | Confidence / boundary |
|---|---|---|---|
| geom::rounded_rect, corner_profile, append_corner; Kurbo0.13.1 Arc | engine/corners.ts | Native cubic profiles, 0.01 arc approximation; geom area/bounds fixtures → corners.test.ts; rounded-corners.png browser baseline | High for Rectangle/Frame; other shapes remain required |
| doc::Corners; cmd::props::apply_corners/four | document.ts, properties.ts, file-format.ts | Native radii order, 1/2/4 expansion, sorted commands, serde defaults; pure tests and authenticated save/reload | High; Group metadata retained but has no painted shape |
| doc::geometry::hits_path and Frame branch; render::draw_children_clipped | selection.ts, canvas.ts | Rounded rectangle winding/distance; rounded Frame paint clip but rectangular hit fallback, browser pixels/selection | High; flattening0.001 versus native nearest0.01 tolerance |
| canvas::shape_handles::{handles,hit,drag,value}; session::preview | corner-handles.ts, EditorEngine.previewProperties | Native48px/10px/6px thresholds, affine projection, immutable-base Alt preview and one undo; pure/browser/performance | High for Rectangle/Frame handles |
| ui-egui::paints; shape_overlay | CornerPanel, CornerInteraction.draw | Mixed controls, individual order, smoothing and60% preset, circles/pill; authenticated desktop/mobile | High for tested controls; shared native field scrubbing/theme remain UI-family work |
| cmd::arrange::scale_node | sizing.ts::scaleSubtree | Scale multiplies stored radii, ordinary resize retains them, overflow rejects atomically | High; pure and browser Scale checks |


## Ellipse geometry and arc editing (0.18.0)

Upstream0b97f3f → Reactf21fe2b;480 pure,2 local Auth and60 browser checks pass. [Property matrix](../reports/26-11-07-ellipse-arcs-parity.html).

| Upstream symbol/source | React target | Behaviour and verification | Confidence / boundary |
|---|---|---|---|
| geom::ellipse/full_sweep; Kurbo0.13.1 Ellipse/Arc | ellipse.ts::ellipsePath; corners.ts contours | Native major-axis phase, full/partial signed paths and opposite-winding ring holes; area/winding fixtures and browser pixels | High for exercised geometry; extreme finite dimensions use documented bounded approximation |
| doc::NodeKind::Ellipse; cmd::create::kind_for/create | EllipseNode; creation.ts; file-format.ts | Native defaults/aliases, raw wire radians, lenient optionals and archive/recovery | High for browser creation/archive; alias/raw malformed cases pure-tested |
| cmd::props arc keys | ellipse.ts::setArc; properties.ts | Start/sweep degrees, fraction/percent ratio, clamps and wrong-kind atomicity | High for UI edits; detailed coercion pure-tested |
| arc_handles::{handles,hit,drag,handle_at,Arc::label} | arc-handles.ts | Signed continuity, Shift steps, complement, affine/zoom guards, labels and one undo | High for browser sweep/ratio/cancel; remaining exact sequences Medium pure evidence |
| tools::{draw_down,draw_drag}; session::preview | DrawInteraction; EditorEngine.previewDraw | Frame parent space, immutable IDs, modifiers, snapping and Move return | High for browser nesting/modifiers; click and endpoint details pure-tested |
| ui::arc_section / arc_overlay | ArcPanel; controller overlay | Mixed signed fields, ring pixels, native save/recovery, mobile; root-free previews | High for tested UI; full shared numeric fields/preferences remain required |

Hosted React Graphify tracks initial main. A local code-only CLI graph of the canonical port branch now supplies current React structure (1058 nodes,4284 edges). Query results were verified against current ArcInteraction, previewDraw and createLayer; excluded Rust reference/generated output. Some symbol-free test/config files and SQL grammar coverage remain outside that local graph; local files/tests remain authoritative.

## Polygon and Star — 7 November 2026

Upstream0b97f3f → Reactf4db7fc;506 pure,2 real Auth and64 browser checks pass, followed by4 focused checks after lexical integer validation. [Property evidence](../reports/26-11-07-polygon-star-parity.html).

| Upstream symbol/source | React target | Verified behaviour / boundary |
|---|---|---|
| geom::{polygon_points,star_points,rounded_polygon,smoothed_polygon} | polygon.ts; ellipticalArcPath | Top vertices, fit/easing, concave Star paths, source area/tangent fixtures; browser pixels and screenshot |
| NodeKind::{Polygon,Star}; geometry::shape_path | LeafNode; shape-path.ts; native codec | Required raw fields/u32 tokens, path hits/caching, native save/recovery, leaf hierarchy/copies |
| kind_for/create; props::apply_shape | creation.ts; shape-properties.ts | Aliases/defaults, count3..120/60, ratio fractions/fallback/key precedence and atomicity |
| shape_handles::{corner,top,ratio_point,drag,value} | CornerInteraction and pure helpers | Top radius/inner ratio, affine projection, eligibility, uniform Alt behaviour, single undo/cancel; browser gesture evidence |
| tools::draw_drag; tool.polygon/tool.star | DrawInteraction; Editor toolbar | Shared Frame-relative Shift/Alt drawing, Move return and zero frame-frequency root updates |
| right::points_section; right::paints | PointsPanel; CornerPanel | Mixed counts, Star-only ratio, smoothing-only expansion and mobile controls |

Local code-only graph refreshed to1097 nodes/4516 relationships and queried for PointsPanel, cornerDrag and smoothedPolygon. Hosted React remains initial-main; graph coverage is supplementary to local implementation/tests. Vector conversion, strokes and shared numeric/UI families remain required.
