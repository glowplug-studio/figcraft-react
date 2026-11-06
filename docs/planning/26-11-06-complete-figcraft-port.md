# Complete browser-relevant Figcraft port

## Execution checkpoint

| Field | Current value |
|---|---|
| Overall status | In progress; full parity is not implemented |
| Active slice | Nested groups, hierarchy and world-preserving structure commands |
| Active phase | Phase 1–3: hierarchy evidence, plan and bounded allocation |
| Upstream baseline | `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; prior parity baseline `8eb0b87646c5aef712326d6c431ccde5408630de` |
| Branch and last verified commit | `prompt/full-figcraft-port`; verified colour `bfa5dd8`; affine `080fc27`, outline check `2404d6b`, reports `ff29f38`; pages `6c988a5`, persistence `41d467b`; integration `fc3b4a6` from updated dev plus rectangle branch |
| Completed slices | Rectangle/host-auth, bounded native persistence/recovery, supported-model pages, affine rectangle geometry/selection and solid appearance verified locally |
| Remaining slices | Every row below except the integrated foundation; static inventory entries remain unverified until mapped and tested |
| Tests last passed | Colour: strict typecheck, 242 pure tests, 2 real local Auth integration tests, package/Next production build, 16/16 authenticated production-browser/performance checks; CSS follow-up 1/1 |
| Files currently in progress | Colour reports; hierarchy evidence and model/command plan |
| Blockers | None |
| Exact next action | Implement common layer/group model and pure hierarchy operations, then integrate native files, structure commands, nested canvas/selection, page subtree operations and browser controls |
| Last updated | 2026-11-06 |

## Scope and continuation

The user explicitly requests one autonomous full-port run. Slices are implementation units, never completion boundaries. Preserve all landed browser-relevant upstream behaviour, including its existing browser host, rather than filling hypothetical Figma gaps from stale aspirational documents. Never import or execute the Rust engine in React code, builds or tests. No merge to main is authorised. Do not publish this branch or deploy partial slices before the full-product Phase 8 gate.

The existing production rectangle demo is a previous release, not evidence of complete parity. No Vercel changes occur during implementation. The roadmap expands whenever inspection finds an omitted feature. Completion requires a fresh audit against the pinned tree, commands, menus, data format, assets, tests and UI.

## Evidence and inventory

- Upstream sync fast-forwarded the authorised fork successfully. `8eb0b876..0b97f3f1` changes only house-rule documentation and its CI workflow; runtime source is unchanged.
- Both authorised Graphify repositories are queryable. Rust graph remains at `8eb0b876`; React graph remains at `b3b8a1b` with four README nodes. Current local files are authoritative. The broad Rust persistence query returned unrelated component/plugin symbols; exact local definitions and subsequent focused queries take precedence.
- Scoped Supabase MCP read succeeded; public application tables remain empty. This is expected for the previous unsaved slice, not sufficient for the complete port.
- [Command inventory](../parity/full-port-command-inventory.json) captures 636 literal `spec!` registrations with source and line evidence. This is an audit seed, not executable parity evidence or a guarantee that dynamic registrations are covered. Each entry starts `Not tested`.
- `original/figcraft/docs/architecture.md` establishes geometry/colour → document → layout/text/collaboration → rendering/format → engine → UI dependencies. Its historical line counts, import support and command counts are stale; current source wins.
- [Full feature inventory](../parity/full-port-feature-inventory.md) records 21 families with exact current source/test anchors and explicit unimplemented coverage.
- Product evidence is independently audited against `docs/*-parity.md`, current command registrations, `catalog.rs`, keymaps and UI modules. The initial feature families below remain subject to that audit.

## Dependency-ordered roadmap and master parity matrix

| Slice | Observable behaviour and source anchors under original/figcraft | Dependencies | Status |
|---|---|---|---|
| 0 | Rectangle transactions, pointer creation, host Auth; existing rectangle plan/report | Existing foundation | Integrated; bounded scope only |
| 1 | Native save/open, exact numeric ids, dirty state, browser recovery; `crates/format/src/lib.rs`, `cmd/file/{save,load,open}.rs`, `apps/figcraft-web/src/{recovery,web}.rs` | 0; explicit wire adapter | Verified bounded page/rectangle codec and local recovery; full archive fidelity remains required |
| 2 | Complete typed document properties and kinds, hierarchy, pages, validation/repair, affine transforms; `crates/doc/src/{lib,node,props}.rs`, `crates/geom`, `crates/color` | 1 codec boundary; split into independently verifiable property families | Not implemented |
| 3 | Selection/hit testing, move/resize/rotate, arrange/align/distribute, duplicate/delete/reparent/group, clipboard; `engine/src/cmd/{edit,structure,arrange}.rs`, tools and document geometry | 2 | Not implemented |
| 4 | Pan/zoom, rulers, guides/grids, snapping, measurement, layer panel, pages/tabs and navigation; `cmd/{view,page}.rs`, keymap/catalog and UI canvas/panels | 2–3 | Not implemented |
| 5 | Shapes, vectors, pen/pencil, booleans, shape builder, stroke geometry; `doc/src/vector.rs`, `geom`, `pathops`, engine tools | 2–4 | Not implemented |
| 6 | Paints, gradients, images/crops/adjustments, masks, blending and effects; `color`, `render`, `cmd/{props,image}.rs` | 2–5 | Not implemented |
| 7 | Rich text editing/shaping, fonts, spans, typography, lists, bidi and outlines; `text`, `doc/src/text.rs`, `cmd/{text,lists}.rs` | 2, 4, 6 | Not implemented |
| 8 | Auto layout horizontal/vertical/wrap/grid, hug/fill/min/max, constraints and resize propagation; `layout`, `cmd/layout.rs`, document props | 2–7 | Not implemented |
| 9 | Components, instances/overrides, variants/properties/slots and sync; `engine/src/assets/components`, `cmd/component/` | 2–8 | Not implemented |
| 10 | Styles, variables/collections/modes/expressions and IO, libraries/assets and updates; `doc/src/{styles,library}.rs`, `cmd/{styles,variables,variables_io,library}.rs` | 2–9 | Not implemented |
| 11 | File workspace, thumbnails, history/checkpoints, branches and conflict review; `cmd/file`, engine branches and library | 1–10 | Not implemented |
| 12 | SVG/raster, REST, .fig, Penpot, Sketch imports and exports; native bundles, SVG/PDF/VectorDrawable/code/raster exports; current format/export crates | 1–11; current source determines actual supported subsets | Not implemented |
| 13 | Online files/dashboard, ownership and share grants, profile data where required, database/Storage RLS; server store and host-neutral adapters | 1–12; verified account mapping | Not implemented |
| 14 | Ordered live collaboration, reconnect/revocation, presence, comments and per-client live undo; `collab`, `engine/src/sharing`, server stores | 13 and stable commands | Not implemented |
| 15 | Prototype interactions, triggers/actions/expressions, overlays, transitions, scrolling and presenter; `doc/src/proto*`, engine prototype runtime and UI | 2–14 as applicable | Not implemented |
| 16 | Boards: shapes/connectors/stickies/stamps/tables/templates; facilitation timer/voting/history; `doc/src/{board,facilitation}.rs`, board commands/tools | 2–14 | Not implemented |
| 17 | Dev Mode inspection/code generation, code connect, annotations/resources/status and changed-state review; engine dev and handoff modules | 2–16 | Not implemented |
| 18 | Plugins, permissions, sandbox limits, panels/widgets and installed-plugin lifecycle; `plugin`, engine extensions and UI | Stable command/data/UI boundaries | Not implemented |
| 19 | Complete UI chrome/menu/actions, preferences/themes, localisation, keyboard/accessibility and host integrations; UI and browser app | All relevant functional slices | Not implemented |
| 20 | Fresh whole-product audit, full parity matrices, performance/security/browser verification and final publication | Every preceding required property passed | Not started |

Each broad row is decomposed into bounded vertical slices before implementation. No row is passed merely because its command exists or an adapter compiles. Native window/process/updater/tray operations may be omitted only with individual evidence; browser-meaningful controls remain required. Native file pickers/downloads, storage, workers, clipboard and browser sandbox are explicit equivalents, not blanket exclusions.

## Active persistence slice: evidence constraints

`figcraft_format::to_json` / `from_json` use a native document object with `format: "figcraft"` and version 1. `.figcraft` is a ZIP holding `document.json`, images, optional thumbnail/history/branches/library. Plain native JSON also opens. The current React rectangle model is deliberately not this wire schema. Never rename its arbitrary JSON to `.figcraft`.

`NodeId` is u64: numeric JSON ids must retain exact lexemes beyond JavaScript safe integers. Node kinds flatten a `type` tag; placement is an affine transform. Default omission, unsupported fields/resources, archive expansion limits, future versions, malformed input, repair and snapshot/save races require explicit parity fixtures. Unsupported editable content must not be silently discarded. The first bounded persistence slice may have narrower editing support while later rows complete model/rendering coverage; that limitation cannot survive the final full-port gate.

`FileSnapshot::of/encode/save` captures a revision and saved reference so a delayed save cannot mark newer edits saved. Browser recovery is already upstream behaviour (`apps/figcraft-web/src/recovery.rs`), so it must be ported rather than invented. Account-backed online persistence follows the native document boundary with declarative schema, verified ownership/RLS, Storage and ordered collaboration as their slices require.

## Verification and delegation

Active slice acceptance: native page/rectangle ZIP and plain JSON open; exact u64 identifiers and allocator; unsupported resources/properties and invalid archives fail without replacing the editor; native download round-trip retains geometry, names and colours; save acknowledgement applies to its captured snapshot; reload recovery remains unsaved and is isolated by principal; failed storage replacement retains the prior copy and reports an error. Tests use an explicitly inspection-derived native fixture until an independently produced upstream fixture is available. ZIP handling uses pinned `fflate` and numeric tokens use `lossless-json`; neither executes Rust. Initial browser resource limits are lower than the desktop limits and must be documented in the codec.

Symbol mapping: `format::{DocumentJson,to_json,from_json,load_limited}` → `src/engine/file-format.ts`; `cmd/file/save::{FileSnapshot,save_to,mark_saved}` → engine file-command snapshot handling; `apps/figcraft-web/recovery::{Unsaved,store,restore}` → host-owned recovery controller and provider-neutral `RecoveryStore`, with IndexedDB transactional replacement as the browser equivalent. Native single-file data open/save is implemented first; complete multi-tab/workspace history and unsupported document kinds remain required roadmap work.

Allocated files: codec agent owns `src/engine/file-format.ts`, its parity tests and native fixture; recovery agent owns `src/backends/recovery.ts`, `src/backends/browser/recovery.ts` and contract tests; coordinator owns model/engine integration, React/host controls, end-to-end tests, dependencies and documentation. No overlapping writes or agent commits.

Coordinator owns contracts, architecture, integration and final review. Read-only agents audit complete-product inventory and exact persistence semantics in non-overlapping scopes. Implementation allocation follows the accepted active-slice plan. Every returned patch receives coordinator review and actual tests. Preserve the canonical tree; no alternate authoring checkout.

For each slice: focused paired fixtures, negative/atomicity checks, shared contracts, full strict typecheck/tests/build, local Supabase checks where applicable, authenticated Playwright primary/error/keyboard/pointer/resize flows, fixed screenshots and frame-frequency performance. Record exact skips and limitations. Then update the matrix and immediately continue. Full publication occurs only once all remaining rows pass and a new exhaustive audit finds no gaps.

## Persistence verification checkpoint

Strict TypeScript, 135 pure tests, two local Auth integration tests and package/Next production builds passed. Eight authenticated Playwright checks passed against local `next start`, including native download/reopen, cancellation, reload recovery, invalid-file atomicity and storage denial; existing canvas screenshot, responsive layouts, pointer render counts and 10,000-rectangle performance passed unchanged. The initial status overlay was moved out of the canvas; a test selector was narrowed to avoid the framework route announcer. No hosted service changes or deployment occurred. No public schema is needed for local browser recovery; online storage remains required later.

The next bounded model slice is page lifecycle: add/select/rename/delete/duplicate/reorder/list and divider invariants, with explicit current-page/history handling and page controls. Full hierarchy waits for affine transforms and container rendering; adding parent identifiers alone would not meet upstream semantics. Source evidence: `cmd/page.rs:13–160`, `doc/src/lib.rs:438–473`, `panels_behaviour_tests.rs:327–393`, `page_target_tests.rs`, `theme_pages_tests.rs`, and `page_copy_navigation_tests.rs`. Page duplication must eventually remap all navigation/resources; current supported documents contain rectangles only, and that limitation remains visible until the model expands.

## Active page lifecycle plan

Acceptance: add, select by ID/index, rename, delete, duplicate, reorder and list pages preserve upstream defaults, ordering, current-page and selection rules. Empty ASCII-hyphen-prefixed pages are dividers; populated hyphen pages are ordinary; mutations may never remove the last ordinary page. Page selection is navigation, not an undo entry or a dirty content change. Content operations are atomic and undoable with their previous page/selection; identifiers never rewind. Duplication uses fresh identifiers and retains background and the currently supported ordered child data. Resource/navigation remapping expands with the typed model and remains a tracked parity dependency.

Mapping: `cmd/page.rs:13–160` → isolated pure `src/engine/pages.ts`, coordinator engine transaction integration and `src/PagePanel.tsx`; `doc::is_divider` → shared predicate; `session/undo.rs` → restored page/selection snapshots. Parameter parsing mirrors upstream lenient number/string/ID handling, including string IDs and strict select versus clamped/truncated move indices. Invalid targets and deletion/rename of the last ordinary page fail before publication. Colour-background editing belongs to the forthcoming colour-model family; it is not falsely marked implemented here.

State: retain cheap immutable page/node maps. Navigation changes the serialised current-page projection and recovery snapshot but dirty detection compares content references, not navigation alone. The saved document content remains an immutable reference. No database or Realtime changes apply. Host identity/capability checks gate commands; the reusable core remains provider-neutral. IndexedDB and native files must round-trip added/reordered/duplicated pages. Page controls provide explicit target names, selectable pages, accessible add/rename/delete/reorder actions; divider buttons cannot open. Tests translate `panels_behaviour_tests`, `page_target_tests`, and supported `theme_pages_tests`, add identity/atomicity/undo/reload checks, and retain canvas screenshot/performance baselines.

Allocation: page reducer agent owns only `src/engine/pages.ts` and `tests/parity/pages.test.ts`; coordinator owns engine/document integration, `PagePanel.tsx`, editor integration and browser tests. Persistence reporting agent owns only the two persistence reports. No overlapping edits. Rollback point: verified `41d467b`. Full hierarchy and affine transforms follow this bounded page workflow.

Page verification: 49 reducer cases and five page/history cases passed; full suite has 190 pure tests plus two separately run local Auth integration tests. Final typecheck, package/Next production build and 10/10 authenticated local production Playwright checks passed (13.4 seconds). New browser flows cover page add/dividers/duplicate/reorder/rename/undo/redo/reload and narrow-screen navigation; last-page delete/rename failures preserve content. Maximum-u64 allocation remains serialisable and the next allocation fails atomically. Persistence report is committed as `ceb9602`; page implementation and its reports follow. No deployment or branch push.

## Active affine geometry plan

Port `geom/src/transform.rs` and native affine coefficients `[a,b,c,d,e,f]`: multiplication order, inverse, full four-corner bounds, screen-convention rotation and centre/flip preservation. Required guards reject non-finite resulting geometry atomically; inverse rejects exact singular/non-finite matrices without an invented near-singular threshold. Paired fixtures translate `geom/src/tests.rs:140–164`; independent algebra fixtures verify composition, skew/reflection and inverse. Canvas painting/selection must use transforms and transformed bounds while pointer previews remain outside React.

The bounded vertical workflow is `node.set` on currently supported rectangles for x/y/width/height/rotation, through inspector controls, history, native ZIP and recovery. Source: `cmd/edit.rs::set`, `cmd/props.rs:410–427,513–562`. Dimensions precede rotation; x/y apply last. Preserve exact command contracts and atomic multi-target validation. Other `node.set` properties remain explicit unsupported work, never silently ignored.

Transition: retain public rectangle x/y/fill compatibility while adding optional native affine coefficients; one accessor and update helper own canonical transform resolution and translation aliases. Plain translated legacy nodes remain accepted. This is a bounded compatibility bridge, not the final common-node schema; full float colour/paint/base-property modelling precedes container hierarchy. Native codec accepts finite affine rectangle transforms and writes them without flattening. Structural/appearance fields remain rejected until supported. Native page-only fixtures continue to round-trip unchanged.

No provider schema or role changes; existing identity gates and principal-scoped recovery apply. Tests include matrix fixtures, transformed native round-trips, centre preservation/undo, invalid transform atomicity, browser inspector→pixels→save/reload, unchanged rectangle screenshot and 10,000-node frame budget. Record the byte-colour, rectangle-only and viewport-fit limitations until their required slices land.

Allocation: bounded affine agent owns `src/engine/affine.ts` and `tests/parity/affine.test.ts`; coordinator owns transform model helpers, codec/renderer/property-command integration, UI and browser tests. Page reporting agent owns only page reports. Rollback point: `6c988a5`.

Affine workflow dependency: imported/recovered rectangles must be selectable before inspector edits. Include the existing upstream `select.set`, `select.add`, `select.remove`, `select.all`, `select.none` contracts for the current flat model, a layer-list action and frontmost rectangle pointer hit testing through inverse affine coordinates. Selection is ephemeral and non-undoable; `select.set` validates existence, switches to the first target page and cleans other-page/duplicate/page selections (`cmd/edit.rs:152–185,507–525`, `doc_state.rs:331–356`). This does not claim marquee, nested hit testing, locked/hidden handling or move/resize gestures, which remain required. Bounded selection agent owns `src/engine/selection.ts` and its parity tests; coordinator integrates engine/canvas/layer controls.

Affine verification: 217 pure tests and two local Auth integration tests passed; strict TypeScript and package/Next production builds passed. Final local production browser suite passed 12/12 (15.1 seconds), including rotation pixels/centre/undo/reload/pointer selection. At 10,000 rectangles over 110 measured frames, plain rendering p95/max were 1.0/1.0 ms; affine rendering p95/max were 5.7/12.5 ms after removing temporary bounds allocations. The pre-optimisation affine run was p95 15.7 ms/max 25.4 ms; that slower implementation is not the accepted checkpoint. No React frame-frequency reconciliation was introduced. Full archive/model/gesture/UI families remain unfinished.

## Active colour and basic appearance plan

Source: `color/src/lib.rs` Color/ColorRepr, Paint/Paint::solid/solid_color; `color/src/hsx.rs`, `lch.rs`, `profile.rs` conversion helpers, and `named.rs`; `engine/src/cmd/props.rs:566–600`; `doc/src/geometry.rs` visibility/lock filtering. Native colours are non-premultiplied clamped f32 sRGB RGBA, not byte-only strings. CSS/hex, object and array inputs must preserve alpha and native numeric precision. Solid paint stores colour, independent opacity/visibility/blend, and `colorAlpha`; a typed solid alpha moves into paint opacity while the stored colour becomes opaque. Preserve that distinction on native round trips. Multiple solid fills paint in order. Gradients/images/patterns/blending/effects remain subsequent required families, with explicit refusal until retained/rendered faithfully.

Acceptance: typed/native colour parsing (hex variations, normalised CSS names, RGB/HSL/LCH/OKLCH), float/alpha native round trips, solid fill/none and paint-stack editing, node name/visible/locked/opacity, page background colour, undo/recovery. Hidden nodes do not paint; hidden/locked nodes are excluded from pointer hits and select-all while explicit layer targeting follows upstream. Rendering must not accumulate transparent backgrounds across frames; node opacity composes a node's paint stack as one layer. Controls expose only implemented upstream properties. Tests translate colour crate fixtures and property behaviour, add fractional-channel/alpha and paint-origin fixtures, test invalid atomic mutations, browser pixels/selection/undo/reload, and retain both 10,000-node performance fixtures.

Architecture: provider-neutral typed colour/solid-paint objects; optional canonical paint/background fields preserve the existing public string aliases until the common-node schema absorbs them. Conversion/parser modules are browser-independent and never depend on Rust. Runtime f32 channels are explicitly rounded; intermediate precision differences require quantified paired tolerances, not byte quantisation. This slice does not create backend tables or product roles. Identity gating and local recovery remain the verified host boundary; cloud document persistence is still required later.

Allocation: coordinator owns colour base primitives, document/codec/renderer/property/selection/UI integration. A conversion agent owns `src/engine/colour-spaces.ts` and focused tests; a CSS agent owns `src/engine/colour-css.ts`, `src/engine/colour-names.ts` and parser tests. No overlapping edits or agent commits. Rollback: `080fc27` with outline test `2404d6b` and report `ff29f38`.

Colour integration review: paint rows now follow native top-first panel order while storage remains bottom-first. RGB-only edits preserve loaded colour alpha/paint opacity provenance; explicit opacity changes clear typed-alpha provenance as `cmd/edit/props.rs` specifies. Canvas layer opacity uses a cropped reusable scratch surface, preserving stack compositing without allocating a viewport surface per rectangle. Existing unit and local Auth checks passed; final production-browser verification follows these review corrections.

Graphify access was renewed successfully. A real query now returns Rust `0b97f3f1`, including `paint_opacity_and_layer_opacity_differ` and group behaviour fixtures. The React graph remains stale at `b3b8a1b` with README-only nodes; current local files remain authoritative. No user action remains for authentication.

Colour verification: 242 pure and two real local Auth integration tests, strict TypeScript and package/Next production builds passed. Final full production-browser suite passed 16/16 in 17.8 seconds, including typed-paint metadata save after RGB/opacity edits. The CSS-only hidden-input/checkbox correction passed a rebuilt focused browser check (1/1, 3.7 seconds); its screenshot was inspected. Plain/affine 10,000-node p95/max were 1.0/1.3 ms and 4.9/8.1 ms over 110 measured frames. No deployment or push. Next: nested group hierarchy with world-preserving group/ungroup/reparent and native/history/rendering integration.

## Active nested group hierarchy plan

The next complete workflow is nested Group/Rectangle trees. Evidence: `doc/node.rs` common fields and container/bounds-follow predicates; `doc/lib.rs:597–666,721–755,811–850` frame-relative/world transforms, reparenting and child-bound fitting; `cmd/structure.rs:182–243,347–375` grouping/ungrouping; `cmd/edit/props.rs:245–260` reparent final-index semantics; `cmd/create.rs:267–369` group-parent coordinate space; `frames_behaviour_tests.rs:202–280` group geometry, empty-group removal and group-opacity fixtures. Graphify independently returned those current-source behaviour tests. Frames follow separately: their clipping, default white fill and coordinate space add a distinct contract.

Acceptance: normalised parent/ordered-child references with Group nodes, cycle/non-container/page guards, exact IDs and atomic immutable transactions; local affine storage with world-preserving group/ungroup/reparent and z-order; group bounds follow children and descendants remain fixed during refit; group resize scales descendants, while inspector X/Y remains in page/frame space rather than group-local space. Nested native JSON/ZIP/recovery retains structure and appearance. Page duplication/deletion traverses supported subtrees and allocates fresh IDs. Group opacity composites overlapping children once; groups paint children only. Selection/layer tree expose groups and descendants with inherited visibility/lock filtering. Group/ungroup, reparent and delete controls dispatch native commands with undo/redo, and failed operations preserve the prior snapshot/allocator.

Architecture: introduce an evidenced common layer interface and `GroupNode` without speculative node kinds. Pure hierarchy helpers own ancestry, world/frame transforms, roots/order, reparent, refit and subtree traversal; coordinator owns transactions, codec validation, creation/property integration and canvas compositing. Retain public rectangle aliases during the transition. Bound traversal and fail singular inverse/overflow atomically; avoid recursive untrusted-file stack overflow. Page references, selection and content history must remain consistent. The rendering layer retains its dedicated loop and flat-rectangle fast path; React draws only the layer tree/chrome.

Mapping: `Document::{world_transform,frame_relative,reparent,fit_to_children,fit_ancestors}` → `engine/hierarchy.ts`; `cmd::structure::{wrap,ungroup}` and `cmd/edit::reparent` → pure structure reducer integrated by EditorEngine; `NodeKind::Group` → typed GroupNode + native codec + recursive Canvas2D subtree; `frames_behaviour_tests` → hierarchy algebra/transaction fixtures and authenticated grouping/pixels/reload checks. Validate 10,000 flat nodes and representative nested groups. Canvas2D alpha isolation is the browser substitute for native pixmap layers; numerical fixtures use tolerances established by native tests (world matrices within 1e-9).

No new provider table, membership or role is required by local grouping. Existing host identity/capabilities and principal-scoped recovery continue; online ownership/Storage/Realtime remain later required families. Allocation: coordinator owns common model, engine/properties/codec/canvas/selection and integration. A bounded hierarchy agent owns only `engine/hierarchy.ts` and `tests/parity/hierarchy.test.ts`; a subsequent structure agent may own the pure structure reducer once helper contracts are reviewed. UI/page subtree work is allocated only after shared model contracts are stable. Rollback point: verified colour `bfa5dd8`. Full publication remains forbidden until all roadmap families pass.
