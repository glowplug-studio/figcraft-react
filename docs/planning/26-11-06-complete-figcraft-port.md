# Complete browser-relevant Figcraft port

## Execution checkpoint

| Field | Current value |
|---|---|
| Overall status | In progress; full parity is not implemented |
| Active slice | Page lifecycle and document navigation |
| Active phase | Phase 7: verified page checkpoint |
| Upstream baseline | `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; prior parity baseline `8eb0b87646c5aef712326d6c431ccde5408630de` |
| Branch and last verified commit | `prompt/full-figcraft-port`; verified persistence `41d467b`; integration `fc3b4a6` from updated dev plus rectangle branch |
| Completed slices | Rectangle/host-auth, bounded native persistence/recovery and supported-model page lifecycle verified locally |
| Remaining slices | Every row below except the integrated foundation; static inventory entries remain unverified until mapped and tested |
| Tests last passed | Pages: strict typecheck, 190 pure tests, 2 real local Auth integration tests, package/Next production build, 10/10 authenticated production-browser checks |
| Files currently in progress | Persistence reports; page command reducer, engine history integration, page controls and tests |
| Blockers | None |
| Exact next action | Finish final page checks and reports, commit verified page workflow, then continue affine scene geometry and containers |
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
