# Cross-repository mapping

Graphify indexes `glowplug-studio/figcraft` and `glowplug-studio/figcraft-react` independently. It does not automatically determine which Rust and TypeScript symbols are equivalent.

Add mappings only after inspecting behaviour, callers, data contracts and tests. Preserve upstream command identifiers, file-format keys and user-facing terminology where they are compatibility contracts; otherwise use idiomatic TypeScript names and record the relationship here.

| Port scope | Upstream Rust module or symbol | Upstream evidence | TypeScript target | Parity tests | Status |
|---|---|---|---|---|---|
| Vector networks and geometry | `doc/vector.rs`, `vector_regions.rs`, native network/region tests | Relative handles/styles, legacy versus styled loops, cubic winding, degree-two rounded corners and linear runs | `cubic.ts`, `vector-network.ts`, `vector-rounded.ts`, `vector-path.ts` | `vector-network.test.ts`, `vector-presentation.test.ts`, vector pixels | Pure mathematics/rendering verified; final86/86 Chromium pass |
| SVG and vector creation | `cmd/create::{parse_path_data,path_network,vector_scale,create}`; pinned Kurbo SVG lexer | Complete source grammar, source compact arcs, unscaled offset and post-scale endpoint merge | `svg-path.ts`, `creation.ts`, native VectorNode/codec | `svg-path.test.ts`, `vector-commands.test.ts`, native-open browser workflow | Current vector/solid subset verified; no Rust runtime dependency |
| Vector path replacement and sizing | `vector_path_set_tests`, `cmd/props::{set_path,apply_geometry}`, `layout::set_size`, `arrange::scale_node` | Six source frame cases, mixed warnings, sequential dimension aliases, radii versus coordinate scaling | `properties.ts`, `document.ts`, sizing/constraints/preview reducers | `vector-commands.test.ts`; authenticated resize/recovery and performance fixture | Commands, files and full86-check regression verified |
| Vector fills and hit testing | `doc/geometry::{shape_path,stroke_geometry,hits_node_itself}`, `render/draw::fill_vector_regions` | Any-region legacy winding; explicit/inherited regional paint; open paths; stroke-only tolerance | `vector-presentation.ts`, `shape-path.ts`, selection/canvas | `vector-presentation.test.ts`, vector pixel and authenticated selection tests | Solid regions verified; downstream union silhouettes/non-solid paints remain dependencies |
| Vector strokes and point styles | `pathops::stroke_outline_of`, `pathops/points::Styled`, `path_end` | Per-run dash fitting, differing point joins, override precedence, open alignment and global/point arrows | `vector-stroke.ts`, `stroke-renderer.ts`, Line band reuse | `vector-presentation.test.ts`, `vector-rendering.spec.ts`,10k vector fixture | Geometry/pixels/performance and full86-check regression verified |
| Flatten and Reverse | `cmd/structure::{flatten,collect_flatten_parts,append_flatten_part,vector.reverse}`, `shapes_behaviour_tests`, `vector_behaviour_tests` |9/7/1 open-path fixture; z roots/parent/index; inherited fills/paint frames; endpoint/handle swaps | `vector-commands.ts`, engine registry, LayerPanel/Editor shortcuts | `vector-flatten.test.ts`; authenticated Flatten/Reverse/download/recovery | Current supported kinds/solid paints verified; authoring/booleans/export remain required |
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

## Line, Arrow and uniform strokes — 7 November 2026

Upstream0b97f3f → React0.20.0 implementation0ca7c35. [Property evidence](../reports/26-11-07-line-strokes-parity.html); full regression checkpoint is recorded in the linked report.

| Upstream symbol/source | React target | Verified behaviour / boundary |
|---|---|---|
| NodeKind::Line; Node::new; kind_for/create_kind | LineNode; creation.ts; file-format.ts | Line/Arrow defaults, native height metadata, independent stroke fields and archive/recovery |
| StrokeProps; props::apply_stroke; scale_node | stroke.ts; scaleSubtree | Native enums, alias ordering, miter conversion, raw wire values, scale versus resize and atomic validation |
| pathops::dash_pattern/dashes_fit/stroke_center/arrowhead | line-stroke.ts; renderDashes | Source dash fit/areas, zero dots, work budget, eight caps and native reversed winding |
| render::stroke_area/stroke_fill | closedStrokeRing; paintStroke | Rectangle/ellipse rings, generic Canvas substitution, alpha overlap and bounded mask cache |
| geometry::shape_path/hits_node_itself/hits_path | shapePath; hitRectangle; strokeBounds | Horizontal Line path, native hit band/outline, stroke-aware culling and opacity bounds |
| draw_drag/click_size; resize_drag; handle_at_corners | DrawInteraction; TransformInteraction; previewResize | Shift45°/Alt drawing, parent inverse, two endpoints, cancellation/undo and no root preview updates |
| edit::props::paint_list/paint_set; lists::move_item | executeStrokeList | Native add/remove/set/move, per-target stacks, metadata precedence, atomic errors and one undo |
| right::paints; right::stroke; keymap | StrokePanel; Editor | Mixed stacks, order, weight/alignment/dashes/caps/joins, L/Shift+L and mobile controls |

Hosted React remains stale default-branch source; current local files and the refreshed local graph are authoritative. Per-side strokes, brushes, variable width, non-solid paints, blend modes, styles/variables and full shared numeric UI remain required; no claimed cross-repository equivalence for those features.

## Per-side Rectangle/Frame strokes — 7 November 2026

Upstream0b97f3f → React0.21.0; [property evidence](../reports/26-11-07-per-side-strokes-parity.html). Verified implementatione21aaf0, reviewed base2b1aece.

| Upstream symbol/source | React target | Verified behaviour / boundary |
|---|---|---|
| StrokeProps::sides; cmd::props::four/strokeSides/STROKE_SIDES | stroke.ts; codec adapter | Native tuple/default/raw finite values, numeric expansion, individual aliases, sorted precedence and atomic history |
| cmd::arrange::scale_node | scaleSubtree | Scale all sides, retain on resize and reject overflow without partial mutation |
| pathops::rect_side_strokes | rectSideStrokes | Native bar ordering, inverted oversized bars and three alignments |
| pathops::rounded_side_strokes/fit_corners/corner_rect | roundedSideStrokes; clippedSideStrokePath | Elliptical inner corners, radius fit, smoothing, collapsed holes; independent bounded convex clipping replaces native general subtraction |
| render::side_strokes/stroke_area/stroke_rule | filledStroke/paintStroke | Rectangle/Frame side precedence; native24-case pixel matrix; imported Line sides preserve even-odd overlap |
| node::outline_reach; render::lod::stroke_box | strokeReach/strokeBounds | Side-aware conservative Rectangle/Frame bounds and Frame child ordering |
| right::paints individual chooser/fields | StrokePanel | Presets, common tuples, mixed selection, undo, save/recovery and mobile controls |

Current local graph1204 nodes/5100 edges resolves these targets. Metadata on other kinds is retained, but general self-intersecting outline/even-odd combinations require the later vector/stroke geometry audit. Component/Instance behaviour extends when those kinds land. Full-product parity remains incomplete.

## Variable-width profiles — 7 November 2026

Upstream0b97f3f → React0.22.0; verified implementation5f035a2, reviewed base47c91d2. [Property evidence](../reports/26-11-07-width-profiles-parity.html).

| Upstream symbol/source | React target | Verified behaviour / boundary |
|---|---|---|
| doc::WidthPoint/WidthProfile/WidthPreset | width-profile.ts | Native sides, presets, sanitisation, monotone interpolation and raw wire values |
| cmd::props::width_profile_of; cmd::edit::width_profile | parseWidthProfile; executeStrokeList | Native forms/aliases/null, atomic targets/history and no implicit paint |
| geom::measure::Polyline/polylines | path-measure.ts | Length/normal/nearest, closed/open paths, finite coordinate and40000-sample guards; independent0.05 flattening |
| pathops::width::variable_outline/resample/outline_piece/dashes | variable-stroke.ts | Source wedge areas, caps/joins, asymmetric widths, holes, native dash fitting, dots and uniform fallback |
| pathops::stroke_outline_of; render::stroke_area/stroke_rule | profilePath/filledStroke/paintStroke | Profile ring bypass, per-side precedence, alignment masks, global-weight arrows and native winding cancellation |
| StrokeProps::max_weight; geometry hits; node::outline_reach | strokeMaxWeight; hitRectangle; strokeReach | Widest-side hit bands and finite conservative rendered bounds |
| cmd::arrange::scale_node | existing scaleSubtree | Scale weight while retaining dimensionless profile points |
| right::stroke::width_profile_row/profile_art | StrokePanel/ProfileArt | Presets/Custom/Mixed/flip, command-driven history, file/recovery and mobile controls |

Local graph1268 nodes/5392 edges resolves the current target chain; hosted React is still stale. Canvas masks substitute native boolean contour clipping; native-select controls substitute the custom popup. General vector booleans/export contours, vector width-point gestures, complete inspector styling and unsupported node kinds remain required. No full-product equivalence is claimed.

## Procedural brushes — 7 November 2026

Upstream0b97f3f → React0.23.0; implementationd3f7934; reviewed basee13f8da. [Property evidence](../reports/26-11-07-brushes-parity.html); 622 pure tests,2 real Auth tests, strict TypeScript/package/Next builds and82/82 Chromium pass.

| Upstream symbol/source | React target | Behaviour and boundary |
|---|---|---|
| doc::Brush/default/sanitized/reach_factor | brush.ts | Raw serde metadata, strict seeds, command clamps and conservative reach |
| props::snake/brush_of/apply_look; edit::stroke_brush | parseBrush; setStrokeProperties; executeStrokeList | Sorted aliases, exact ids, conditional paint, null reset and atomic history |
| pathops::brush::PRESETS/shape/band | brushShape | Eight independent procedural shapes with native bounds |
| pathops::brush::rand | brushRandom | Exact wrapping splitmix64 using BigInt; independent integer fixture values |
| pathops::brush::outline/stretch/scatter | brushOutline; measurePath | Native subpath sampling,0.002 unit flattening, profile mean, seeded jitter and actual multi-subpath spacing semantics |
| render::stroke_area; stroke_outline_of; StrokeProps::max_weight | profilePath/paintStroke; strokeMaxWeight/strokeReach | Side/brush/profile precedence, uniform fallback, alignment, alpha, arrows and culling |
| right::stroke::brush_row/brush_art | StrokePanel/BrushArt | Presets/Mixed/scatter fields, percentage jitter, memoised outline preview and authenticated recovery/mobile |

Local graph1298 nodes/5558 edges resolves these targets. Pencil pressure, vector authoring, vector.outlineStroke and export remain required dependencies. Canvas masks and native HTML selects substitute native boolean contours/custom popup UI for this bounded workflow. Full browser parity remains incomplete.

## Vector point authoring — 7 November 2026

Upstream `0b97f3f` → React0.25.0; reviewed base `58c0981`, verified implementation `adc59d4`. [Property evidence](../reports/26-11-07-vector-authoring-parity.html):735 pure tests,2 real Auth checks, strict TypeScript/package/Next builds and89/89 Chromium pass.

| Upstream symbol/source | React target | Verified behaviour / boundary |
|---|---|---|
| vectoredit::ops movement/handles/mirroring/smooth/bend/split/delete/merge | vector-edit-ops.ts | Independent immutable geometry, handle snapshots, region repair, healing and finite guards |
| vectoredit::{begin_many,end,refit,clamp_doc,activate,selected_points} | vector-edit.ts / EditorEngine | Multi-layer conversion/history, bounds refit, ephemeral selection and native lifecycle |
| vectoredit::specs; params::f64_of/indices | vector-edit-commands.ts | Twenty native command identifiers and bounded diagnostics, coordinate spaces, lenient optional parsing and atomic errors |
| vectoredit::{hit,hit_any,visible_handles}; Kurbo CubicBez::nearest | vector-edit-hit.ts / cubic-nearest.ts | Page-distance priority, stable ties, independent stationary-polynomial roots, short handles and singular guards |
| vectoredit::pointer::{vector_down,vector_drag,vector_up,merge_dropped_point} | VectorInteraction / EditorEngine previews | Point/segment/handle gestures, midpoint/Alt insertion, Bend, marquee and one-step history; snapping/point-box branches remain next |
| tools::double_click; vectoredit::key | MoveInteraction.doubleClick / Editor.key | Hollow selected shapes, multi-layer entry, nudge/select/delete/heal/exit and browser button activation |
| ui-egui::vector_overlay / edit_toolbar / vector_panel::points | drawVectorEdit / VectorToolbar / VectorPanel | Screen-sized overlays, Move/Bend/Done, point position/radius/mirroring/cap/join, recovery and mobile controls |

The refreshed local graph contains1,566 nodes/7,185 edges and locates the interaction/controller/test chain; bounded queries are not exhaustive impact audits. Both hosted repositories are queryable again. Rust is pinned at0b97f3f; React still indexes only four README nodes atb3b8a1b. Full vector tools, point transforms/snapping, width-point diagnostics, shared scrubbing/chrome and full-product parity remain required.

## Vector point transforms and snapping — 2026-11-07

Reviewed base `adc59d4`, reference `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. Verified implementation `4a762cd`. Full92-check regression and final focused oversized-dimension correction checks pass. Global parity baseline unchanged. Both hosted graphs are queryable; React remains README-only at `b3b8a1b`. Current local AST has1,611 nodes/7,508 edges; `VectorPointTargets` resolves to capture/gesture callers, SnapTargets and paired fixtures (87 neighbours,25 shown in the bounded query).

| Upstream source/symbol | Independent TypeScript implementation | Evidence / confidence |
|---|---|---|
| `canvas/vectoredit/transform.rs::point_box`, `PointBox::onto`, `layers_box`, `shown_box` | `vector-point-transform.ts::vectorPointBox`, `pointBoxOnto`, `shownVectorPointBox` | Paired active/page-frame and degenerate fixtures; Medium |
| `transform.rs::transform_points`, numeric specs | `transformVectorPoints`, `vector-edit-commands.ts` | Four native command contracts, overflow atomicity, history and saved coordinates; numeric dimensions browser flow; High for exercised dimensions, Medium for matrix-only properties |
| `cmd/arrange.rs::flip`, `rotate_by`, `transform_in_edit_mode` | `rotation.ts::executeRotation`, `EditorEngine` | Explicit target bypass, active-only edit routing and rotated-parent fixtures; Medium |
| `transform.rs::box_hit`, `pointer.rs::box_down`, BoxScale/BoxRotate | `hitVectorPointBox`, `VectorInteraction`, Canvas overlay | Priority/modifier/interior/multi-layer fixtures and edge/rotation browser flow; High for browser-covered properties, Medium otherwise |
| `vectoredit/point_snap.rs::targets_moving`, `snap`; `canvas/snap.rs::snap_points` | `VectorPointTargets`, captured sorted `AxisIndex` | Exclusions, budgets, tie ordering, pixel/lock behaviour,100-case native-scan comparison and browser point snapping; High for browser-covered snapping, Medium for bounded algorithm properties |
| `cmd/view.rs` object/pixel toggles and tools/draw/drag consumers | `executeView`, `ViewControls`, draw/move/transform controllers | Document/history preservation, fractional drawing and browser switches; High for switches, Medium for engine-only cases; persisted preferences remain required |
| `ui-egui/src/panels/vector_panel.rs::points` dimensions | `VectorPanel` | Authenticated dimensions, undo/native recovery/mobile fields and fixed canvas screenshot; High |
| `ui-egui/src/canvas/measure_overlay.rs` point marker | `measurements.ts::drawGuides` | Exact guide marker fixtures and Canvas cross rendering; Medium |

Engine source paths are relative to `original/figcraft/crates/engine/src`; UI paths are relative to `original/figcraft/crates`. See the [property report](../reports/26-11-07-vector-point-transforms-parity.html). Guides/grids, Pen, cross-session preferences and remaining product families are explicitly unclaimed dependencies.

## Pen and open-path authoring — 2026-11-07

Reference `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; React0.27.0, reviewed base `4a762cd`, internal foundation `653e4a4`; verified integration d3c00a4. Global baseline unchanged. Forty new paired fixtures pass within803 pure tests;2 real Auth tests, strict TypeScript/package/Next builds and67 authenticated browser checks pass. Final97-check regression passes in231.3s without failures, skips or flakes. The [46-row property report](../reports/26-11-07-pen-authoring-parity.html) separates paired-only properties from browser-covered workflows.

| Upstream source/symbol | Independent TypeScript target | Evidence / boundary |
|---|---|---|
| `canvas/tools/pen.rs::{pen_down,pen_update,pen_finish,end_pen_path,pen_double_click}` | `pen-path.ts`, `PenInteraction`, `EditorEngine.previewPenPath` | Native bounds/parent coordinates, one transaction per new path, closure/join/resume, finish transitions and cancellation; paired fixtures plus two authenticated workflows |
| `canvas/tools.rs::{PenPath,pen_handles,at_45_degrees}`, `tools/drag.rs::PenDrag` | `PenAnchor`, `penPathHandles`, `penAt45`, `PenInteraction.move` | Mirrored handles,3px slop, strict8px anchor hits,45° length-preserving placement; paired geometry tests and browser dragged-handle capture |
| `canvas/vectoredit/ops.rs::{connect,path_between}` | `connectVectorPoints` and ordered adjacency | Endpoint-only unfilled closure, stable shortest-chain order, finite fallback and20,000-point chain; paired-only Medium |
| `canvas/vectoredit/pointer.rs::{PenPlan,apply_pen,pen_plan,pen_click,pen_double_click_editing}` | `vector-pen.ts`, `VectorInteraction`, `vector-edit-commands.ts` | New/connect/split/branch, closing handles, local Shift, captured coordinates, per-click history and double-click correction; paired fixtures; disconnected continuation browser coverage |
| `canvas/vectoredit.rs::{set_tool,escape,specs}` | `VectorEdit`, native `vector.edit.pen`/`vector.edit.penEnd`, Editor keyboard routing | Ephemeral anchor/tangent, topology clamping and active-layer lock; repeated Pen/Escape/Enter transitions; paired and browser evidence |
| `canvas/vectoredit/point_snap.rs::{PenTargets,snap_pen}` | `PenSnapCache`, existing sorted snap targets | Immutable-document/layer/extras invalidation, object/pixel switches and modifier semantics; paired fixtures and measured browser hover |
| `ui-egui/src/canvas/overlays.rs::pen_overlay` and edit-mode rubber band | `drawPen`, `drawVectorEdit` | Native handle/anchor order, cubic new-path band, dashed edit-mode band; source review and fixed screenshot |
| `cmd/view.rs::tool`, `tool.scaleAnchor`; Pen catalogue/keymap | `EditorEngine.execute`, `Editor`, `VectorToolbar`, `CanvasController` | Tool switches finish; Scale-anchor preference preserves path; labelled Pen/P controls and mobile bounds. Full native icons/chrome and later mode transitions remain required |

Engine paths are under `original/figcraft/crates/engine/src`; UI paths under `original/figcraft/crates`. Local AST has1,676 nodes/7,938 edges. Hosted Rust graph resolves pinned Pen symbols; hosted React remains README-only at `b3b8a1b`, so current local source is authoritative. Browser Canvas/pointer capture/HTML controls are explicit substitutions. No provider/schema changes. Pencil, regions, width editing, booleans and other master-roadmap families remain required.


## Pencil authoring — 2026-11-07

Reference `09e04e71765517975950403eec4cb6fbe8955359`; verified implementation `7ad8a5a`, sampling foundation `b630d0c`. All 102 Chromium checks pass in 219.9s on React 0.28.0. The global baseline is unchanged. The [property matrix](../reports/26-11-07-pencil-authoring-parity.html) links paired fixtures, authenticated Chromium workflows and performance evidence. Engine paths below are under `original/figcraft/crates/engine/src`.

| Source / symbol | Independent TypeScript target | Observable equivalence / confidence |
|---|---|---|
| `canvas/tools/{pointer,drag,draw}.rs` Pencil input; `pen.rs::pressure_profile` | `PencilInteraction`, `shouldSamplePencil`, `pencilPressureProfile`, `pencilPointerPressure` | Strict half-pixel spacing, final release, f32 length-resampled pressure, mouse omission. Paired native pressure fixture and browser tapered-file capture; High for browser-covered properties. |
| `canvas/tools/pen.rs::pencil_finish`, `handles.rs::PENCIL_STROKE` | `pencilPath`, `PencilInteraction.up`, `node.create` | First-point frame, inverse parent transform, open unfilled black round stroke, one undo. Rotated-parent geometry is paired-only Medium; mouse/pressure completion and save/recovery High. |
| Kurbo 0.13.1 `simplify.rs::{simplify_bezpath,SimplifyBezPath}`, `fit.rs::{fit_to_bezpath,fit_to_cubic,CurveDist}` | `simplifyPencil`, `FittingPolyline`, `fitPencilRun`, `FittingDistance` | Native corner threshold, pass-through lines, moments, tangent rays, arc correspondence, penalties, subdivision. Dense independent geometric checks; Medium for numerical equivalence. |
| Kurbo `fit.rs::cubic_fit`; `common.rs` quadratic/cubic/quartic factor routines | `cubicFitCandidates`, `fitQuadratic`, `fitCubicRoots`, `fitQuarticFactors`, `fitMultiplyAdd` | Native candidate ordering/complex real parts, polynomial fixtures, correctly rounded arithmetic and independent coefficient reconstruction. Medium; no independent native executable was used. |
| `cmd/view.rs::tool.pencilBrush`; `brush_tests` | `EditorEngine.execute`, existing `parseBrush` and `wireBrush` | Omitted preset read, null clear, future strokes only, invalid preset atomicity and brush/profile round trip. Medium; no native brush picker was found or invented. |
| `ui-egui/src/canvas/overlays.rs::pen_overlay`, `canvas_fixes_tests`; native Pencil keymap | `PencilInteraction.draw`, `CanvasController`, `Editor` | Black polyline with max(2 × zoom, 1) screen width; no anchor dots; actual capture/cancel/lost-capture and zoom preservation. Four authenticated workflows, desktop screenshots and mobile bounds. High for these interactions. |

Analytical line integrals and adaptive Simpson/bisection replace equivalent native numerical procedures; tolerances and precision limits are documented in the [verification report](../reports/26-11-07-pencil-authoring.md). Hosted React Graphify remains README-only. No schema or provider change applies. Width-point editing, regions, booleans and the remaining master roadmap stay required.


## Pen anchor history — 2026-11-07

Upstream `0e6fcf9b` at reference `7522c39b` supersedes open-path undo behaviour from the earlier Pen report. React implementation `6ffb65a`; global baseline unchanged.

| Upstream source/symbol | Independent target | Evidence and scope |
|---|---|---|
| `canvas/tools.rs::PenPath.undone`; `canvas/tools/pen.rs::{pen_down,pen_undo,pen_redo,pen_update}` | `PenInteraction.travel`, path-local removed-anchor stack and existing preview geometry | Paired native three-to-zero anchor fixture, complete handle restoration, discarded redo branch, one-layer threshold and exact order. |
| `session/undo.rs::{undo,redo}`, `cmd/edit.rs` history command specs | `EditorEngine.execute` | Anchor travel precedes normal history; an earlier real document redo remains available. Finished paths retain one history entry. |
| Keymap Edit Undo/Redo and host history controls | `Editor.dispatch`, `HistoryButtons`, `CanvasController.cancel(true)` | Authenticated keyboard/buttons, no root preview updates, save/recovery and mobile bounds. No per-frame React state. |

See the [property report](../reports/26-11-07-pen-anchor-undo-parity.html). The hosted Rust graph predates these new methods; current source and `pen_undo_tests.rs` are authoritative. Existing live per-client undo remains a separate roadmap dependency.

| Port scope | Native evidence | TypeScript target | Verification |
|---|---|---|---|
| Fractional target priority | `39c58338`, draw.rs::draw_drag, drag.rs move/resize, transform_behaviour_tests::snapping_to_layers_wins_over_the_pixel_grid | DrawInteraction, MoveInteraction and TransformInteraction | [Paired fixtures](../../tests/parity/snap-priority.test.ts) and [browser evidence](../reports/26-11-07-snap-priority-parity.html), implementation 4b86d41 |

`1aa6b81d`, `65060159`, `41ec33ee`, `5244b007` and `421a8e51` map respectively to createLayer, executePage/parseIndex, executeStructure, setStrokeProperties and frameRelative. [Ten verified command/geometry properties](../reports/26-11-07-command-validation-parity.html), React 2a37b75.

Native vectoredit/ops.rs connect/join and vectoredit.rs join_cmd map to vector-connect.ts and vector-edit-commands.ts. The same region repair serves Pen, explicit connect, Join and Smooth join. [Property evidence](../reports/26-11-07-vector-join-parity.html).

Native vectoredit/width.rs maps to vector-width.ts, VectorInteraction and VectorPanel. Stroke profile, shape geometry, command and undo boundaries are shared. [Per-property evidence](../reports/26-11-07-width-point-authoring-parity.html).

Native smoothed_corner, rounded_smoothed and drawn_network map to the shared polygon corner profile, vector-rounded geometry and drawnVectorNetwork. CornerPanel exposes smoothing on closed vectors after recovery. [Geometry, file, inspector and browser evidence](../reports/26-11-07-closed-vector-smoothing-parity.html).

Native vector_faces and vectoredit::paint_all map to vector-faces.ts, vector-paint.ts, vector.edit.paint and VectorInteraction. The reference hatch spacing and region loops are verified in the authenticated preview. [Property matrix](../reports/26-11-09-vector-paint-bucket-parity.html).

Native vectoredit::region_hit, region_under, region_down and region_hatch map to hitPaintedRegion, VectorInteraction, selectVectorParts and regionHatch. Authenticated pointer, file, visual and 10,000-node evidence passed at React 59700e8. [Property matrix](../reports/26-11-09-vector-region-selection-parity.html).

Native selected_region_fills, fill_regions, edit_region_fills, paint_list, paint_set_in and paint_copy/paste correspond to selectedRegionFills, writeFill, paintStackEdit and the session paint clipboard. Native inspector mixed state and contextual copy/paste use existing React appearance rows. [Regional solid paint evidence](../reports/26-11-09-vector-region-fills-parity.html).

## Cut, Eraser and Lasso

Native vectoredit/ops.rs cut_vertex, cut_segment, cut_across and parts map to vector-cut.ts. Native inside_ranges and erase map to vector-erase.ts. The Rust pointer and overlay gestures map to VectorInteraction, drawVectorEdit and VectorToolbar. The public commands share EditorEngine history and the hierarchy allocator. [Property evidence](../reports/26-11-09-vector-cut-erase-lasso-parity.html).

## Vector winding

Native structure.rs fill_rule, area_index, short_loop_segments and reverse_loop map to vector-winding.ts, the public vector command runner and undo history. Native vector_fill_rule_tests.rs supplied the paired ring, squares, lenses and shared single-segment cases. [Verified property matrix](../reports/26-11-09-vector-winding-parity.html).

## Live boolean groups

At be059b7, pathops budget/boolean_step/simplify_with_rule map to path-budget.ts and path-boolean.ts. Rust render::boolean::fold_cached maps to boolean-result.ts. Engine booleans.rs and inspect.rs map to structure.ts, properties.ts and inspect.ts. The native group/operand command, geometry, cache, refusal, hit, menu and storage cases are reported individually. [Property matrix](../reports/26-11-09-live-boolean-groups-parity.html).

## Outline stroke

At 70cf052, native cmd/structure.rs outline_stroke and render/draw.rs stroke_fill map to paintedStrokePath and vector.outlineStroke. shapes_behaviour_tests, brush_tests and the two width-edit suites supply local geometry and history assertions. Desktop and narrow layer actions persist actual editable vector geometry. [Property matrix](../reports/26-11-09-outline-stroke-parity.html).

## Offset path

At dfdffca, native structure::offset_path maps to vector-offset.ts and the existing cubic kernel. The native regional, legacy winding, paint-space, corner-smoothing and container-preservation tests map to vector-offset.test.ts. The signed amount control maps to MenuInput::Offset and persists through the authenticated Next.js host. [Property matrix](../reports/26-11-09-offset-path-parity.html).

## Simplify vector

At dcc3c82, structure::simplify and the Kurbo cubic fitting rules map to simplifyVector, simplifyPath and CubicFitSource. Engine fixtures and authenticated native save, undo and recovery cover fitted geometry and colour. [Verification and evidence](../reports/26-11-09-simplify-vector-parity.html).

## Shape Builder

At a132b69, pathops::faces, union_faces and canvas/shapebuilder.rs map to path-arrangement, shape-builder, shape-builder-commands and ShapeBuilderInteraction. Native sources and named tests are linked from the [twelve-property matrix](../reports/26-11-09-shape-builder-parity.html). The independent browser tool covers fills, strokes, paint frames, atomic commands, input and recovery for supported node and paint types. Text contours, linked styles, auto layout and gradient sampling retain their downstream obligations.

## Gradient paints

At 113507a, color::Gradient, paint::prepare_at and diamond_pixmap map to gradient.ts and gradient-renderer.ts. Native paints, inspect, edited_list and set_gradient map to readPaint, paintStackEdit, pickedGradient and previewPaint. Native picker stop operations map to PaintPicker and GradientInteraction. Native files, sample colours, rotation, capture, undo and recovery have [property-level evidence](../reports/26-11-09-gradient-paints-parity.html).


## Native image resources and archives

At d629a99, format::read_images, report_lost_images, image_index and the native stored image writer map to readArchive, readMember and encodeFigcraft in file-format.ts. ImageData maps to the immutable Blob-backed ImageResource. The image budget, missing member, corrupt CRC, unsafe key, duplicate entry and exact-byte cases live in file-format.test.ts. RecoveryController and the authenticated file workflow cover local restoration and downloads. The file-size difference and remaining pixel decode work are recorded in the [image paint plan](../planning/26-11-09-image-paints.md).

At 7b32853, color::ImageFilters::PRESETS, doc::ImagePreset and cmd::image's image.presets route map to image-filters.ts, document.imagePresets and EditorEngine.execute. The file codec writes native image_presets only when present. image-presets.test.ts checks immutable f32 data, read-only command behaviour, native persistence and atomic refusal. The six-format Chromium workflow verifies a saved preset after reload and download.

At 6877404, create::place_image and file::open map to prepareImage, placeImage and the asynchronous engine transaction. render::paint::image_transform and images::shown map to image-placement and image-renderer. image-paints.test.ts, image-rendering.spec.ts and the authenticated file workflows verify sizes, paint frames, decoded pixels, undo and recovery. At e889fff, the native first-directory TIFF path in the pinned image/tiff dependencies maps to decodeTiff and decodeImageBitmap. The independent fixtures and outstanding variants are recorded in the [image plan](../planning/26-11-09-image-paints.md#image-placement-and-editing-checkpoint).

At 096ede0, cmd::image::{adjust, replace, save_preset, deletePreset registration} maps to editImagePaints, replaceImage and editImagePreset. Layer counts, target indices, multi-layer atomicity, unchanged paint properties, preset limits, undo and native persistence are verified in image-commands.test.ts. Picker interactions and linked-style detachment retain separate parity obligations.

At 35ac0bd, widgets::colorpicker image_pending, upload_image, image_well, image_controls and image_presets map to PaintPicker, ImagePaintControls and EditorEngine.uploadPaintImage. preview.spec.ts exercises the placeholder, pixel preview, chooser, drop, undo, file recovery, presets, keyboard sliders and mobile stroke controls. region-fills.test.ts covers isolated region upload and cancellation. Multi-file routing, profile display and canvas crop remain open.

At d826723, canvas/input.rs::import_dropped and menus/clipboard.rs::paste map to rasterImportParams, editor file transactions and the canvas or picker drop route. The two authenticated workflows test ordering, page/viewport coordinates, clipboard reads, undo, text focus and recovery. At 34a3e3d, cmd/image.rs::crop and canvas/handles.rs::{crop_target,draw_crop,crop_ghost} map to startImageCrop, ImageCropInteraction and CanvasImages.drawGhost. Crop mode and picker gestures share image placement coordinates. The rotated-resize fixture, stroke-picker test, browser pixel comparisons and [bracket reference](../../tests/e2e/preview.spec.ts-snapshots/image-crop-brackets.png) verify the relationship.

At 8ca195d, figcraft_format::jpeg::finer_than_first maps to jpegHeader and the shared decode refusal. tiff 0.11.3 predict_f32 maps to undoFloatPrediction. image-resource.test.ts and tiff-image.test.ts check marker layout, channel ordering, padded tiles and original bytes. The animated GIF editor workflow matches ui-egui/src/idle_tests.rs and checks the canvas schedules zero redraws across multiple frame boundaries. Time-based playback belongs to the presenter.

At ba25ef5, render/src/images.rs::shown and draw.rs::pixels_when_magnified map to CanvasImages and drawPixels. largeImagePaints recreates both upstream striped images, counts the actual browser decode sizes, samples 800 magnified pixels and times sixty warm redraws.

At 3c80225, image_profile.rs::png_chunks maps to pngProfileName and the colour-managed browser image path. The image.place return value and picker label read the same resource metadata. Native file round trips retain all source bytes. Tests sample the linear grey and wide-primary PNGs in the running sRGB host and compare the colour label after each open.

At 29902bc, render/src/image_profile.rs::{from_icc,managed,name,Source::convert} maps to embeddedIcc, iccDescription, readImageResource and openIccTransform for sRGB documents. tests/parity/image-icc.test.ts verifies bounded extraction, name selection, real transforms and preservation when conversion is unavailable. Authenticated browser tests sample PNG, JPEG, WebP, TIFF, grey and lookup-table colours and reopen the original archive member. See the [working-space checkpoint](../planning/26-11-09-image-paints.md#embedded-icc-and-document-working-space).

At 8d97001, file/save.rs::color_profile and doc/src/colors.rs::set_color_profile map to file.colorProfile and setDocumentProfile. Alpha, the palette, page/prototype backgrounds, layer/region paints and gradient stops survive conversion, assignment, undo and native archives. Colour-bearing types absent from the current document model remain open. render/src/images.rs::finish and ui-egui/src/canvas/render_worker.rs::{screen_image,mark_outside_srgb} map to decodeVariant, paintPage and convertColourPixels, including view.proofSrgb after compositing. The [dialog reference](../../tests/e2e/preview.spec.ts-snapshots/document-working-profile.png), [native property tests](../../tests/parity/document-profile.test.ts) and [pan/composite test](../../tests/e2e/profile-rendering.spec.ts) cover the mapped behaviours.

At f64eeb0, render/src/images.rs::decode_within delegates TIFF to tiff 0.11.3 and zune-jpeg 0.5.15. decodeTiffJpeg validates shared tables, scans and coefficient allocations. decodeRawJpeg preserves raw sample order and matches the scalar two-axis interpolation. The TIFF photometric conversion owns CMYK, grayscale alpha and RGBA. tests/parity/tiff-image.test.ts and the authenticated two- and four-component TIFF browser workflow cover original bytes, actual pixels and worker decoding.

At beb8ddc, format/src/lib.rs::read_images and Unpacked::read map to readArchive, ArchiveReader and archivedImage. readMember streams and checks CRC before retaining a stored range. encodeFigcraftBlob and the device recovery adapter preserve archive bytes through a real file selection and reload. tests/parity/file-format.test.ts covers declared size, corrupt inflation, count and later members. The authenticated 24 MiB BMP workflow checks actual pixels, recovery and exact downloaded bytes.

At 17fabdd, PixmapCache::insert and get_within map to the serial CanvasImages LRU. ImagePage suspends fill and stroke painting while a bitmap is decoded. The suspended hierarchy retains group opacity, frame clipping and paint order. The pressure, interruption, byte-budget and magnified-image fixtures in tests/e2e/image-rendering.spec.ts verify the mapping.

At c52be88, format::document_limit and the wasm32 archive budget map to documentByteLimit. readNativeJson parses large native node dictionaries incrementally, readNode converts each record and prepareArchive writes immutable revisions in batches. The native-json and file-format suites cover lossless ids and invalid input. The authenticated large native JSON browser fixture verifies multibyte fields over 16 MiB through recovery and save.

At bc3f065, ui-egui panels/layers.rs::show_viewport and reveal_selection map to LayerList and LayerPanel. The authenticated wide native page fixture tests tree levels, bounded rows and options, keyboard focus, nested expansion, reparent and exact saved child relationships. The wide-page file-format test checks duplicate references beyond 10,000 nodes.

At 84df96d native paint_copy and paint_paste map to copyPaint, pastePaint and usePaintActions. The copied image retains its encoded source. Occupied legacy names use the SHA-256 digest and numbered suffixes. Source hash computation shares the archive member validation stream. The [image property matrix](../reports/26-11-09-image-paints-parity.html) links the collision, missing-data, access, stroke settings and authenticated download fixtures.

At 67b16e6, PatternPaint::cell and the integer raster sizing in render::pattern::cell_pixmap map to patternCell and patternResolution. The native colour pattern tests supply exact grid, half-shift, origin and gap fixtures. Live pixel comparisons remain in the active [pattern plan](../planning/26-11-09-pattern-paints.md).

## Live pattern paints

| Upstream at 8a7ebc24 | React at 438cf6f | Verified behaviour |
|---|---|---|
| PatternPaint::cell, render::pattern::{prepare,cell_pixmap}, draw_node | patternCell, patternResolution, resolveLayerPaints, drawLayer | Live local source, grid and hex offsets, nesting, cross-page depth, image decode, clips and bounded pixel surfaces. |
| pattern_fill, paint_set_in, paint_paste, Document::paste_nodes | writeFill, pastePaint, remapPatternSources, native codec | Layer-only command, separate regional stacks, file identity, numeric u64 round trips and subtree-specific remapping. |
| colorpicker::{pattern_sources,pattern_controls} | patternSources, PaintPicker, PatternPaintControls | Eligible sources, scale, gaps, layout, alignment, scrub undo and recovery. Component and text-range targets await their respective node models. |

[Property-level evidence](../reports/26-11-09-pattern-paints-parity.html).

## Layer and paint blending

| Upstream at 8a7ebc24 | React at 9c678db | Verified behaviour |
|---|---|---|
| color::BlendMode, render::paint::{ts_blend,composite}, fx::plus_darker | blendModes, canvasBlend, plusDarkerPixels and compositeSurface | All 19 opaque reference colours, partial alpha, native aliases and file tags. |
| draw::{fill_with,needs_layer,draw_layer} | paintPath, paintMask, paintComposite and loneNormalStroke | Cropped gradient, image and pattern coverage, transformed regions, clipped frames, isolated groups and matching translucent arrow edges. |
| panels/right/menu::{blend_menu,preview_blend}, widgets/colorpicker::preview_blend | BlendMenu, beginBlendPreview, AppearancePanel and PaintPicker | Pointer hover, keyboard focus, dismissal, one history entry, role loss, stroke/region independence, mobile recovery and download. |

[Property-level evidence](../reports/26-11-09-blend-modes-parity.html).

## Alpha, vector and luminance masks

At Rust 8a7ebc24 and React 87ced5f, doc::Node mask flags and engine::cmd::structure map to immutable node records, executeStructure and fitToChildren. Render draw_children, mask_pixels and draw_masked map to drawChildren, maskOutline, drawMasked and reserveLayerPixels. Doc::geometry masked_out, covers and layers_at map to masksBelow, covers and queryPoint. The command and canvas context menu use the same layersAt ordering. Typed archive, pixel, memory and authenticated acceptance evidence passed. [Mask matrix](../reports/26-11-09-masks-parity.html).

## Layer effect rendering

At Rust 8a7ebc24, render::shadow and render::fx map to shadow-renderer and effect-raster. Render::blur and render::backdrop map to blur-renderer, backdrop-stack and backdrop-renderer. Render::grain maps to grain-renderer. Render::glass distance and nearest-site transforms, AnalyticRect, shape_fields and glass map to glass-fields, glass-rectangle, glass-shape, glass-lens and glass-renderer. [Dated checkpoint and pixel evidence](../planning/26-11-09-layer-effects.md#glass). The Effects inspector, bindings and downstream export surfaces remain open.

## Character styles and Unicode ranges

At Rust a4251ca8, doc::text TextStyle, TextData, StyleRun and ParaList map to the TypeScript text-style and text-data modules. The native style_at, spans, normalisation, range replacement and paragraph-list operations map to text-ranges. Native TextCase conversion maps to text-case. Ten focused cases cover stored records, pattern IDs, Unicode offsets, case context, style inheritance and paragraph edits. Browser text layout, shaping and authoring remain open. [Checkpoint](../planning/26-11-09-rich-text.md).

The native TextData layout_key, save_breaks and saved_breaks_for methods map to textLayoutKey, saveTextBreaks and savedBreaksFor. Six fixed keys from the native crate and 4,093 generated numeric cases matched. [Saved-line-break evidence](../planning/26-11-09-rich-text.md#saved-line-breaks).

Native text/build.rs input_fonts and craft_fonts at a4251ca8 map to the five packaged font binaries, fonts/catalog.css and the Next.js editor host. Native Face::advance and advance_at supplied the static and variable metric fixtures in the authenticated browser font test. [Font evidence](../planning/26-11-09-rich-text.md#bundled-font-resources).

The single-face HarfRust step inside text::layout::shape_segment maps to ShapingFace.shape. FontDb::add_bytes and Face::from_bytes supply the collection and face-reading contracts for readFontFaces. Seven sets of native output agree in Node and Chromium. Higher-level segment metrics, cluster selection and line placement remain open. [Glyph evidence](../planning/26-11-09-rich-text.md#opentype-glyph-shaping).

Native breaks::grapheme_step and backspace_step map to TextGraphemes.step and backspace. The React wrap class rules implement break_between, justify_between, is_space and safe_emergency_break. Nine full editing grids matched in Node and Chromium and 2,025 wrap pairs matched native output. [Boundary evidence](../planning/26-11-09-rich-text.md#grapheme-navigation-and-wrap-opportunities).

Native FontDb::find, default_face, fallbacks_for and pick_cluster_face map to FontLibrary and fontSegments for loaded faces. Face::axis_values and variation_info map to ShapingFace.axisValues and fontVariations. Native layout supplied the per-glyph reference for mixed-script selection. [Font selection evidence](../planning/26-11-09-rich-text.md#loaded-font-selection-and-variable-instances).

Native layout::shape_segment and glyph_at map to styledGlyphs and styledSegment for logical items, case mapping, glyph ranges, script synthesis, metrics and tracking. Fifteen single-line fixtures compare glyph coordinates using native baselines. Paragraph-level layout and rendering remain open. [Styled glyph evidence](../planning/26-11-09-rich-text.md#styled-glyph-positions).

Native Bidi::of, visual_order and visual_gaps map to textBidi, resolveParagraph, visualOrder and visualGaps. styledGlyphs consumes automatically resolved levels. [Unicode and browser differential evidence](../planning/26-11-09-rich-text.md#bidirectional-paragraphs-and-visual-order).

Native break_lines, wrapped_lines, restyle_breaks, list_markers, list_step, layout, truncate_layout and add_ellipsis map to TextLineBreaker, TextListLayout and layoutTextFlow for line, list and truncation geometry. Word-model inputs, glyph painting and text-path warping are separate. [Line flow evidence](../planning/26-11-09-rich-text.md#line-flow-list-markers-and-truncation).

Native breaks::word_breaks and the wasm32 segmenter map to textWordStarts and layoutText. The browser loads the four ICU4X 2.4.0 LSTM models on demand. The independent TypeScript implementation matched 6,000 native word-boundary masks. [Word and layout evidence](../planning/26-11-09-rich-text.md#complex-script-word-boundaries).

Native shape_segment uses HarfRust 0.13.3. ShapingFace now uses matching HarfBuzz 14.3.1 fallback shaping and Unicode 17 properties. The 19 previously failing mixed-script cases passed alongside the additional 10,000 layouts. [Shaper evidence](../planning/26-11-09-rich-text.md#shaping-fallback-and-unicode-tables).

Native Face::outline_at, FlipPen and Glyph::layer_path map to ShapingFace.outline, fontOutlinePath and glyphPath. The independent FreeType reader shares the shaper’s font buffer and uses the normalised axis location. [Outline and browser evidence](../planning/26-11-09-rich-text.md#browser-glyph-outlines).

Native OnPath::new, frame, place and TextLayout::warp_point map to TextOnPath, layoutTextFlow and textWarpPoint. The shared path sampler retains quadratic segments and uses the upstream measurement bounds. [Text path fixtures and comparison](../planning/26-11-09-rich-text.md#text-on-a-path).

Native TextLayout::caret, visual_step, hit and selection_rects map to textCaret, textVisualStep, textHit and textSelectionRects. The tests exercise native scalar positions, bidirectional spans, trailing breaks and transformed hits. [Caret reference and verification](../planning/26-11-09-rich-text.md#caret-geometry).

Native Decoration::path, ink_cuts, TextLayout::ink_bounds and to_path map to decorationPath, the skip-ink band intersection, textInkBounds and textToPath. [Decoration and ink verification](../planning/26-11-09-rich-text.md#decoration-paths-and-paint-bounds).

Native Face::color_layers and read_layers map to ShapingFace.colourLayers and FontColourTables.layers. [COLR palette and browser verification](../planning/26-11-09-rich-text.md#layered-colour-glyphs).

Native Face::color_bitmap, read_bitmap, placement, scaled and Glyph::color map to ShapingFace.colourBitmap, readStrikeBitmap and glyphColour. [Bitmap geometry, pixels, ownership and limits](../planning/26-11-09-rich-text.md#bitmap-colour-glyphs).

Native `NodeKind::Text`, `layout_node`, `auto_size` and the text arm of `render::draw` map to `TextNode`, `textNodeLayout`, `autoSizeText` and `paintText`. [Rust and browser interchange, measured geometry and remaining editor work](../planning/26-11-09-rich-text.md#native-text-layers-and-file-interchange).

Native canvas `text_down`, `text_box_drag`, `textedit::begin/end`, `select_word` and `preedit_doc` map to `CanvasTextInput`, `createCanvasText`, `EditorEngine.beginTextEdit` and `textWordRange`. [Canvas gestures, edit history, Unicode and input-method evidence](../planning/26-11-09-rich-text.md#canvas-creation-editing-and-input-methods).

Native `automation::inspect::text_props` maps to `inspectText` through `node.get`. [Independent native field comparison](../planning/26-11-09-rich-text.md#text-property-inspection).

Native `apply_text`, `apply_text_style`, `font_style_warnings`, `fontdb::styles` and the typography panel map to `setTextProperties`, `FontLibrary` and `TypographyPanel`. The inspector retains the canvas scalar selection and formats it in the open history transaction. [Native command and document comparisons](../planning/26-11-09-rich-text.md#typography-commands-and-inspector).

Native text formatting, `toggle_bold`, `list_key` and link activation map to `executeTextFormat`, `textShortcut`, `listKey` and `textLinkAt`. [Target selection, list typing and URL evidence](../planning/26-11-09-rich-text.md#formatting-commands-lists-and-links).

Native `on_path`, `stroke_geometry`, `resize_cmd`, `nudge_size` and text scaling map to `putTextOnPath`, `textPathData`, `fixTextSize`, `refitResizedText` and `scaleTextData`. [Path coordinates, saved records and text sizing](../planning/26-11-09-rich-text.md#attaching-and-resizing-text-on-paths).

Native `fonts::missing`, `fonts::refit` and `FontDb::has_family` map to `missingFonts`, `refitText` and `FontLibrary.hasFamily` for supported text layers. [Family counts, stale boxes, undo and deferred style inputs](../planning/26-11-09-rich-text.md#missing-families-and-text-refitting).

Native browser `ask`, `load_wanted`, `FontDb::add_local` and `load_local` map to `LocalFontAccess`, `FontLibrary.offerLocal`, `finishLocal` and `observeLocalFonts`. [Registration, permissions, native selection and file sizes](../planning/26-11-09-rich-text.md#browser-installed-fonts).

Native typography’s font picker maps to `FontFamilyPicker`. Native preview and end-preview map to the editor’s transient render document. Native cluster-face fallback maps to `fontSegments` and `FontLibrary`. [Scope and comparisons](../planning/26-11-09-rich-text.md#font-picker-and-transient-previews).

Native `text.fonts`, `text.loadFont`, the browser branch of `rescan_system_fonts`, and `fonts::refit` map to `queryFonts`, `importFontBytes`, the browser rescan result and family-filtered `refitText`. [Catalogue, collection and browser evidence](../planning/26-11-09-rich-text.md#font-catalogue-verification).

Native typography `variable_axes`, `named_instances` and `type_settings` map to `TypographySettings`, `AxisControl` and `TypographyPanel`. Browser `familySample` uses the editor’s glyph painter for the native `font_preview::family` path. [Inspector property matrix](../reports/26-11-09-font-catalogue-inspector-parity.html).

Upstream `canvas/textedit.rs` and its nine `cmd/text.rs` entries map to `executeTextEdit`, `EditorEngine.beginTextEdit`, `textKeyMotion` and `CanvasTextInput`. The comparison matched 443 native edit sequences. The installed package and signed-in Next.js host passed browser checks. [Editing matrix](../reports/26-11-09-text-edit-sessions-parity.html).

Native `path_at` and `text_on_path_down` map to `textPathAt`, `hitPathLeaf`, `createTextOnPath` and the Text tool group. The 432 native probes include 162 hits. `collect_flatten_parts` and `TextLayout::to_path` map to `textNodePath`, `textToPath` and `vector.flatten`. All 108 geometry comparisons and the signed-in curved-text workflow passed. [Gesture matrix](../reports/26-11-09-text-gestures-parity.html).

### Auto layout frame records

At 3839fe4a the native AutoLayout and GridTrack serde values map to readAutoLayout and wireAutoLayout at 4b17c70. The node inspector returns camel-case layout fields, while the archive writer emits their native snake-case names. High confidence for container records from 1,014 native comparisons and a signed-in Chromium open, recovery and save. Layout computation and child placement are pending. [Frame record tests](../../tests/parity/auto-layout-records.test.ts) and [slice plan](../planning/26-11-09-auto-layout.md).

### Auto layout placement, grid tracks and flow

Native grid_place, grid_geometry and layout_frame map to placeGridCells, gridGeometry and reflowChangedFrames. Native flow distribution, wrapped lines and first baselines map to reflowFlow. Native layout.setTrack maps to setGridTrack and GridTrackPanel. Comparisons cover 480 placement grids, 420 track geometries, 200 nested grids and 1,250 nested flow documents. The browser exercised track editing, wrapped siblings and undo. [Verification and fixtures](../planning/26-11-09-auto-layout.md#grid-and-flow-geometry).

Native apply_layout, the container track branch of apply_sizing, and layout_panel direction, alignment, spacing and advanced controls map to setFrameLayout and FrameLayoutPanel. Mixed selection, undo and command validation matched across 1,300 native command steps. [Verification](../planning/26-11-09-auto-layout.md#container-editing-at-fd736f1).

Native child sizing and grid properties in cmd/props.rs and explicit sizing in cmd/arrange.rs map to child-layout-properties.ts, sizing.ts and ChildLayoutPanel. Native layout.add, layout.remove, layout.removeAll and layout.suggest map to editLayoutStructure, FrameLayoutPanel and editor keyboard and context actions. [Sizing and structure comparisons](../planning/26-11-09-auto-layout.md#child-sizing-at-1702886).

Native canvas/al_keys.rs, wrap_slot_rows and auto_layout_slot map to nudgeFlow and autoLayoutSlot. Native al_keys_tests.rs maps to [keyboard regression tests](../../tests/parity/layout-navigation.test.ts). [Native and Chromium comparisons](../planning/26-11-09-auto-layout.md#keyboard-reordering-at-9f911fb).

Native canvas/tools/drag.rs, drop::grid_cell_at, drop::drag_parent and cmd/create::frame_at map to placeMove, gridCellAt, dragParent and frameAt. Native al_drag_tests map to [pointer regressions](../../tests/parity/layout-drop.test.ts). [Native event and Chromium pixel comparisons](../planning/26-11-09-auto-layout.md#pointer-reordering-at-984680e).

Native edge_double_click and handle_at map to TransformInteraction.doubleClickEdge. Native ui-egui canvas/handles.rs al_zones and padding/gap apply branches map to layoutZones and LayoutSpacingInteraction. [Native headless fixtures and browser results](../planning/26-11-09-auto-layout.md#canvas-sizing-and-spacing).

### Layout field and sizing verification

Native widgets/field_math.rs and widgets.rs map to [field-math](../../src/engine/field-math.ts) and [LayoutNumber](../../src/LayoutNumber.tsx). Native right.rs field_of, position_values and layout_panel.rs dimensions map to [GeometryPanel](../../src/GeometryPanel.tsx), [shownGeometry](../../src/engine/geometry-fields.ts) and EditorEngine.editMixedGeometry. The two implementations matched through 1,440 edit and undo snapshots including rotations, constraints, nested frames and proportional resizing. Independent sibling writes share validation. Nested writes preserve selection order and read their starting values from the original document.

The seven case tables in native layout/src/behaviour_tests.rs map to [65 reference rules](../../tests/fixtures/native-layout-rules.json) and [two-pass layout checks](../../tests/parity/layout-rules.test.ts). The fixtures include the native synthetic text measurements. Separate signed-in Chromium checks cover actual shaped text, clipping, save from a focused field, mixed constraints, and overlapping paint and hit order. [Property matrix](../reports/26-11-09-auto-layout-parity.html).


Native NodeKind::is_frame_like maps to isFrameLike for components, component sets, instances and frames. Native ordered_props maps to orderedComponentPropertyNames. The component create command maps to executeStructure and node.create maps to createLayer. The [component checkpoint](../planning/26-11-09-components-instances.md) records the native tree, file round-trip, creation, selection and browser evidence.

Native components/guard.rs, patch.rs, diff.rs, instances.rs and sync.rs map to the [component edit boundary](../../src/engine/component-edits.ts), [override groups](../../src/engine/component-groups.ts) and [instance rebuild](../../src/engine/component-sync.ts). The [dated comparison](../planning/26-11-09-components-instances.md#instance-edits-propagation-and-rollback) records the verified fields, native session counts and outstanding nested behaviours.

Rust `create_instance_at` and `sync_instance_depth` map to [instance creation](../../src/engine/component-instances.ts) and [mirror rebuilding](../../src/engine/component-sync.ts). Rust `set_props`, `describe_props`, `variant_options`, `find_variant`, `exposed_copies` and `slots_of` map to [variant and property handling](../../src/engine/component-variants.ts), [component traversal](../../src/engine/component-tree.ts) and the [instance inspector](../../src/InstancePanel.tsx). Native reset, push, detach and restore map to the [instance commands](../../src/engine/instance-commands.ts). Native and browser coverage is recorded in the [component checkpoint](../planning/26-11-09-components-instances.md#instance-lifecycle-and-property-controls).

Rust variant `combine`, `wrap_in_set`, `add_variant` and `fit_set` map to [variant authoring](../../src/engine/variant-authoring.ts), [subtree duplication](../../src/engine/duplicate.ts) and the [Layers panel actions](../../src/LayerPanel.tsx). The [authoring comparison](../planning/26-11-09-components-instances.md#creating-and-extending-variant-sets) covers placement, sibling order, naming, eligibility and rejected duplicates.

Component property definition, slot authoring and binding commands map to [property authoring](../../src/engine/property-authoring.ts), [main visibility propagation](../../src/engine/component-tree.ts) and the [Design inspector](../../src/ComponentPanel.tsx). The [native comparison and browser checks](../planning/26-11-09-components-instances.md#authoring-properties-bindings-and-slots) exercise set-wide declarations, bound fields, renames, deletion, variant defaults and undo.


Rust `library::asset_folder`, `asset_root`, `component::place`, `drop::swap_target`, `sync::keep_text_overrides` and `instance::swap_at` map to [component Assets commands](../../src/engine/component-assets.ts), [drop destinations](../../src/engine/canvas-selection.ts) and the [Assets panel](../../src/AssetsPanel.tsx). The merged local index connects placement to the layout slot, cycle check and instance insertion. Native captures verify which ancestor accepts a drop, set-name matching and undo after swapping to an existing main. [Verification and outstanding thumbnail checks](../planning/26-11-09-components-instances.md#local-assets-in-the-browser).

Native `Document::world_render_bounds`, `render_bounds_at`, `children_render_bounds` and the egui thumbnail renderer map to [world render bounds](../../src/engine/render-bounds.ts) and [isolated thumbnail rendering](../../src/engine/canvas.ts). The combined graph connects renderAssetThumbnail to worldRenderBounds, drawLayer and font preparation. Registration of individual Playwright tests is verified in source. [Native dimensions and pixels](../../tests/fixtures/native-asset-thumbnails.json) and [performance and visual checks](../../tests/e2e/component-performance.spec.ts).


Rust `Variables::resolve`, `resolve_memo`, `set_mode`, `Document::modes_for`, `inherited_modes` and the Design variable mode picker map to [typed resolution](../../src/engine/variables.ts), [layer and instance modes](../../src/engine/variable-modes.ts) and [the frame inspector](../../src/VariableModesPanel.tsx). Command comparisons cover real mode and collection records, undo, component propagation, inherited overrides and archive recovery. [Native comparisons and Chromium evidence](../planning/26-11-09-styles-variables-libraries.md#layer-mode-inheritance).

Rust `style_vars::kind_for`, `refresh`, `settle`, `cmd::styles::bind_style` and `derived::binding_scope` map to [style variable projection](../../src/engine/style-variables.ts), [consumer updates](../../src/engine/style-application.ts) and [style commands](../../src/engine/style-commands.ts). Native catalogue readbacks, individual layer comparisons, the scoped editor picker and a 10,000-consumer benchmark verify these mappings. [Checkpoint](../planning/26-11-09-styles-variables-libraries.md#shared-style-variable-bindings).

Rust `cmd::styles::bind_variable`, `apply_bindings_matching`, `cmd::lists::rebind_edited_paint`, `remap_list_bindings` and `component::apply_prop_bindings` map to [layer binding resolution](../../src/engine/layer-variable-bindings.ts), [list edits](../../src/engine/list-variable-bindings.ts) and [explicit field detachment](../../src/engine/layer-variable-fields.ts). The combined local graph contains both sets of implementation symbols. [Native and browser verification](../planning/26-11-09-styles-variables-libraries.md#direct-layer-variable-bindings).

Rust `cmd::lists::character_fills` and `take_character_fills` map to [character fill selection and promotion](../../src/engine/text-layer-fills.ts). The paint clipboard uses the same resolved stack. [Native comparisons and signed-in fixture](../planning/26-11-09-styles-variables-libraries.md#character-fills-and-paint-copy).

Rust `variable_ui::bound_name`, `number_field_mixed`, `bindable` and `kind_fits` map to the [shared inspector picker](../../src/StyleVariablePicker.tsx) and [numeric inputs](../../src/LayoutNumber.tsx). Native `derived::normalize` during interactions maps to the [render document projection](../../src/engine/editor.ts). [Variant, performance and browser evidence](../planning/26-11-09-styles-variables-libraries.md#inspector-bindings-and-live-previews).

Variable interchange at 8f8791e maps native `cmd/variables_io.rs`, `format/src/rest/variables.rs` and `assets/token_roles.rs` to `variable-export.ts`, `variable-rest.ts`, `variable-import.ts` and `variable-css-names.ts`. Native output fixtures, merge and cycle regressions, signed-in downloads and the large catalogue workflow verify the mapping. [Evidence](../planning/26-11-09-styles-variables-libraries.md#variable-file-exchange).

Library publication at d2cd04a maps `assets/library.rs::{closure,publish,default_selection}`, `cmd/library.rs::{publish_cmd,list}` and `format/src/library.rs::{read,write}` to `library-publish.ts`, `published-library.ts`, the ZIP codec and the Assets publish form. Native and React writers cross-read the immutable publication, including separate asset versions and image data. Consumer imports and updates remain open. [Evidence](../planning/26-11-09-styles-variables-libraries.md#local-published-library-archive-boundary).

Local library links at e9cee6b map `cmd/library.rs::{add,list,remove}`, `assets/library.rs::find_link` and `doc/library.rs::LibraryLink` to `library-links.ts`, the engine file picker and the account-scoped browser publication store. Six native observations and the signed-in consumer recovery/download flow passed. Imported asset pruning remains part of the next checkpoint. [Evidence](../planning/26-11-09-styles-variables-libraries.md#linked-consumer-files).

Linked variables at 425c44a map `assets/library.rs::{import_variables,pending,accept_updates,prune,check_read_only}`, `cmd/library.rs::{alias,extend,set_mode}` and the native variable picker to `library-variables.ts`, `library-updates.ts`, the immutable editor and React inspector controls. Tests use two Rust publications and compare the complete linked, accepted and pruned variable catalogue. [Evidence](../planning/26-11-09-styles-variables-libraries.md#linked-variable-imports-and-updates).

Linked styles at a329a88 map `assets/library.rs::{import_styles,pending,accept_updates,prune}`, `cmd/library.rs::apply_style` and `widgets/style_picker.rs::listing` to `library-styles.ts`, `library-records.ts`, the update dispatcher and the Assets and Design pickers. Evidence includes three native archives, whole-document comparison in `library-styles.test.ts` and signed-in range, image and recovery checks. [Evidence](../planning/26-11-09-styles-variables-libraries.md#linked-style-imports-and-updates).

Linked components at 016c207 map `assets/library.rs::{closure,import,localize,prune,check_read_only}`, `doc/library.rs::ensure_library_store` and the Assets placement commands to `library-component-source.ts`, `library-components.ts`, `library-store.ts`, the editor and the Assets panel. Native archive, nested property and structural updates, drag placement, Alt-swap and offline recovery have direct evidence. [Component store checkpoint](../planning/26-11-09-styles-variables-libraries.md#linked-component-store-and-placement).

Whole-library replacement at 163980f maps `assets/library_swap.rs::{swap_library,match_components,b_main,match_styles}` and session history normalisation to `library-swap.ts`, `component-edits.ts` and the Assets panel. [Swap fixtures, native comparisons and workspace dependencies](../planning/26-11-09-styles-variables-libraries.md#whole-library-swap-evidence).


The local 0.52.0 candidate maps the two `panel.libraries` command requests, the Libraries catalogue and Alt+3 to the editor snapshot and responsive Assets panel. Native `asset_folder`, `foldered` and `build_listing` map to shared source-folder extraction and the source-specific fold and search state at d12c2e6. Queries preserve fold choices and hide libraries without a match. [Property matrix](../reports/26-11-10-styles-variables-libraries-parity.html).

## Local file workspace and branches

| Pinned Rust surface | React surface | Verified behaviour |
| --- | --- | --- |
| `engine/cmd/file`, tab order tests and web recovery | `EditorWorkspace`, `WorkspaceRecovery`, `WorkspaceEditor` | Native command replay and signed-in multi-tab recovery. |
| `cmd/component::go_to_library_main` | `EditorWorkspace.goToMain` | Opens the editable author and selects its original component ID. |
| `cmd/file/version`, `format::read_versions`, `cmd/file/save::thumbnail` | `VersionHistory`, archive codec, `VersionPanel`, `renderFileThumbnail` | Rust reopened downloaded versions. Browser cover and page pixels matched native PNGs. |
| `sharing/branches::{create,open_tab,archive,current,file_tab}`, `format::{read_branches,save_bytes_with_history}`, `doc::set_client_id` | `EditorWorkspace`, `branch-ids`, `file-format` | Native branch-history interchange, separate client IDs and owner-scoped edit, save and recovery. |
| collab/{frac,diff,merge}, dev/devcompare | branch-position, branch-merge, branch-apply, branch-review and VersionPanel | Six reviews, twelve resolution combinations and fourteen layout, paint and subtree comparisons against Rust. The signed-in local merge and undo passed. Specialised review descriptions remain open. |

[Property report](../reports/26-11-10-file-workspace-parity.html)

Rust edit clipboard, appearance and file path commands map to the workspace layer clipboard, property clipboard and browser file menu. Cross-file linked IDs, images and property transfer passed native replay and production browser tests. Rust export_area and export_file map to export-area, canvas and export-png. [Raster evidence](../reports/26-11-10-file-interchange.md).

Rust ExportSetting, export_setting, export_jobs and asset_jobs map to export-settings, export-jobs, export-layers and ExportPanel. Eight native sessions exercise settings, validation and persistence. Six exercise layer order, skipped counts, asset selection, names and folders. Rust JPEG and WebP exports map to renderRasterExport, export-image-profile and the JPEG worker. [Interchange evidence](../reports/26-11-10-file-interchange.md).

Rust svg::try_export_svg, W::layer, render_node, children, pattern_tiles and text_element map to renderSvgExport, SvgWriter, reversedRuns, svg-format and svg-text. See the [native SVG sessions](../../tests/fixtures/native-svg-export.json), [XML comparisons](../../tests/parity/svg-export.test.ts) and [Chromium pixel comparisons](../../tests/e2e/raster-export.spec.ts). Native shadow filters, effect images and stroke dashes map to svg-shadows, svg-effect-images and svg-dashes. Chromium compared 15 shadow scenes, seven dash scenes and ten effect images. SVG import is in progress.

Rust import.rs and import/{shape,paint,fx,text,budget} map to [SVG import](../../src/engine/svg-import/document.ts) and its XML, geometry, paint, gradient, pattern, filter, text and image modules. The [native corpus](../../tests/fixtures/native-svg-import.json) supplies layer records and pixel probes. [Chromium comparisons](../../tests/e2e/raster-export.spec.ts) and the signed-in file, drop and paste workflow passed at c14f32a. Extended cases outside that corpus remain in progress.

Rust SVG colour resolution, text paths and outlined text map to svg-import/{colour,text-path,outlined-text}. The extended Chromium cases compare native layer data, two editable round trips and bounded resolution of external and embedded resources. Rust vectordrawable::{walk,paint,xml,warnings} maps to [the browser drawable writer](../../src/engine/vector-drawable/export.ts). Verification covers the three compatibility modes, skewed gradients, embedded glyph outlines, mask runs, XML names and error order. [Native sessions](../../tests/fixtures/native-vector-drawable.json) · [Pure checks](../../tests/parity/vector-drawable.test.ts) · [Browser checks](../../tests/e2e/raster-export.spec.ts).

| Rust file export and PDF print, draw, text and raster modules | src/engine/pdf, export-effect-raster and editor file commands | 52429e0. Local Graphify mapped renderPdf, PdfFonts and frames_pdf to the respective sources. The React graph has 5,647 nodes and 25,842 edges. The merged graph has 33,285 nodes and 112,976 edges. The extractor found no symbols in the top-level page parity test, which was inspected directly. Independent rendering checked 99 pages, with six native refusal cases and one oversized vector checked structurally. [PDF evidence](../reports/26-11-10-file-interchange.md#pdf-export) |

Rust append_pages, Renames and merge_store map to appendPages and appendedAssets. At 6d643af the React graph contains 5,669 nodes and 25,937 edges. The merged graph contains 33,307 nodes and 113,062 edges and resolves the Rust and TypeScript import operations. [Native page append evidence](../reports/26-11-10-file-interchange.md#native-page-appending).
