# First browser editing slice and dependency-ordered port roadmap

## Execution checkpoint

| Field | Current value |
|---|---|
| Overall status | Blocked — production verified; GitHub homepage metadata remains |
| Active phase | Phase 8.10–11 — homepage metadata and final reporting |
| Upstream baseline | `8eb0b87646c5aef712326d6c431ccde5408630de` (fork, original upstream and parity record agree) |
| Branch and last verified commit | `prompt/rectangle-slice`; verified application `5314525b2f6ad9ef793091e082d7199a3537c07d`; deployment exclusions and browser configuration `f5ed4bd`; exact deployed source `f64d9c7`; core `d71b73d`; starting `f6450d5` preserved |
| Completed work | Mandatory documents read; upstream sync passed; both Graphify repositories queried; Supabase MCP read succeeded, public schema empty; first slice selected; Phases 2–4 implemented and reviewed; local reset and advisers passed |
| Tests last passed | 68 unit/contract/parity/local integration tests; 6 Playwright flows against the production build; strict typecheck, package and Next.js build; staged and stable hosted Playwright each 6/6; runtime-error scan clean |
| Files in progress | None; README and release evidence finalised; deployed source is unchanged |
| Blockers | GitHub MCP verified the repository but cannot edit its homepage; browser control timed out; no CLI credential. Manual Website update requested. |
| Exact next action | Verify repository Website equals https://figcraft-react.vercel.app; complete metadata evidence and checkpoint. The tested production deployment is already live. |
| Last updated | 2026-11-06T22:06+07:00 |

## Scope and acceptance

Port one independently testable workflow: create a rectangle in a fresh local design document, observe its selected geometry and undo/redo that creation. This establishes the model → command → interaction → pixels → React chrome path needed by later editing behaviours. The host additionally supplies the authentication foundation explicitly required by the execution prompt.

Acceptance: `Untitled` contains `Page 1`; a rectangle has upstream defaults, coordinates, dimensions, selection and one undo step. A parameter form dispatches `shape.rectangle`; canvas drawing supports reverse drags, Shift square, Alt centre, pixel rounding, click placement, Escape cancellation and return to Move. Keyboard undo/redo and tool selection use command dispatch. Resize preserves document geometry. Sign-out clears host identity and disables editing. Invalid/unsupported command input fails without changing document or history. Full source, parity, build, local Auth and Playwright checks must pass. Browser screenshots and render/input measurements are required.

This is local unsaved editing, as upstream `Session::new` and `Document::new` provide. It does not claim save/load, `.figcraft` compatibility, all `node.create` kinds/properties, object snapping, viewport navigation, manipulation of existing layers, sharing or multiplayer. No disabled controls or implementation stubs for those future slices. The rectangle command's supported parameter subset is explicit; unsupported properties must fail, never silently disappear.

## Evidence and roadmap

Reference: `original/figcraft/`, commit above. `docs/architecture.md` establishes dependencies L0 geometry/colour → L1 document → L2 layout/text/collaboration → L3 rendering/format → L5 engine → L6 UI. Registry is `crates/engine/src/cmd/*`, not the menu catalogue. Existing React source contains only a root wrapper and identity/access contracts, no editor engine.

| Order | Complete future workflow | Dependencies and upstream evidence |
|---|---|---|
| 1 (this run) | Create a rectangle; select, undo and redo it | `doc/src/lib.rs`, `node.rs`; `engine/src/cmd/create.rs`; `engine/src/tests.rs::create_select_undo_redo`; `canvas/tools/draw.rs`; `ui-egui/src/toolbar.rs` |
| 2 | Navigate and manipulate existing page layers | Slice 1; `canvas/tools/pointer.rs`, `drag.rs`, `cmd/edit/select.rs`, `cmd/arrange.rs`, viewport and keymap |
| 3 | Save and reopen the supported document subset | Stable model/commands; `format/src/lib.rs`, `cmd/file/{save,load}.rs`; ZIP document/images; round-trip fixtures before broader compatibility claims |
| 4 | Frames, hierarchy and deterministic auto layout | Slices 1–3; `doc/src/node.rs`, `layout/`, `cmd/structure.rs`, `cmd/arrange.rs` |
| 5 | Paints, vectors, text and image editing | Geometry/colour + hierarchy; `color/`, `geom/`, `text/`, `pathops/`, `render/`, `cmd/{props,text,image}.rs`; each is its own bounded slice |
| 6 | Components, styles and variables | Stable hierarchy, layout and properties; `cmd/component/`, `cmd/styles.rs`, document variables |
| 7 | Account-backed online files and access grants | Save/load + existing identity contracts; server `store/files.rs`, `links.rs`, access mapping; owner RLS and token-private adapter |
| 8 | Live collaboration and comments | Stable command changes + online access; `collab/`, `sharing/live/`, `cmd/comment.rs`; ordered reconciliation, per-client undo, attributed comments |
| 9 | Prototypes, Dev Mode/export, libraries and plugins | Their model/render/command dependencies above; separate upstream engine and format modules; never use codegen as the editor |

No timescale or speculative product features are assigned. Later steps must repeat evidence selection against the then-current upstream.

## Cross-repository mapping

Graphify Rust index matches `8eb0b87`; create impact links `create_kind`, `frame_create`, `kind_for`, `opt_id`, `opt_index`. Graph-linked tests are sparse and do not prove runtime coverage; local `engine/src/tests.rs` supplies the paired rectangle/undo fixture. React Graphify is stale at `b3b8a1b` (four README nodes), so local tracked sources at `f6450d5` are authoritative. Both authorised repositories are queryable. No cross-repository semantic equivalence is inferred by Graphify.

| Upstream symbol/evidence | TypeScript target | Verification | Initial confidence |
|---|---|---|---|
| `Document::new`, ordered `pages`, normalised `nodes`, `NodeId(u64)` | `src/engine/document.ts` | Empty-page and stable-id fixtures | Medium (inspection) |
| `Node::new(Rectangle)`, colour defaults D9D9D9/F5F5F5 | Document rectangle constructor and Canvas renderer | Model assertions + sampled pixels | Medium |
| `cmd/create.rs::create`, `shape.rectangle`, undo flag true; `create_select_undo_redo` | `src/engine/editor.ts` command transaction | Paired x=10,y=20,w=30,h=40 fixture; rollback and redo | Medium |
| `tools/draw.rs::draw_drag`, `up`, `ToolId::click_size` | `src/engine/geometry.ts`, browser controller | Reverse/Shift/Alt/click/cancel fixtures and Playwright | Medium |
| `render/src/lib.rs::render_one`, ordered children and page background | `src/engine/canvas.ts` | Canvas pixel/order tests, fixed screenshot | Medium |
| Toolbar Rectangle and Move; selection in document state | `src/Editor.tsx` | Keyboard, pointer, geometry and history browser assertions | Medium |
| Host identity/access contracts (no upstream accounts) | Next.js host + Supabase adapter | Shared contract, real local Auth tests, denied backend calls | Medium |

## Architecture and hazards

- Framework-independent normalised Document/Node subset with ordered page children, discriminated page/rectangle kinds and decimal-string identifiers; no invented SceneGraph. No native-format serializer until the format slice. String ids avoid u64 precision loss; bounded local allocation and immutable command snapshots prevent shared-mutation/history bugs.
- Command dispatch is the sole committed edit path. A gesture previews transient geometry then commits once. Undo/redo retain stable identifiers; new edits discard redo. Invalid input is checked before mutation. Rust f64 geometry maps to finite JS numbers; Rust half-away-from-zero pixel rounding is explicit, including negative halves. Shift sign handling and reverse/Alt extents need paired fixtures.
- Canvas 2D is selected for flat solid axis-aligned rectangles: its fill/transform/order operations express this entire slice without a rendering library, GPU setup, shader pipeline or DOM node per layer. This is not a commitment for advanced blend/text/vector parity. Dedicated controller schedules dirty frames with requestAnimationFrame; pointer state never enters React. React observes only committed document/tool/history snapshots and owns chrome. No global state library needed.
- Fixture: 10,000 rectangles, continuous pointer preview, fixed Chromium viewport and device scale. Record p95 render and pointer-handler time; target under 16.7 ms rendering and 4 ms input, zero React commits during pointer movement. Empty frames do not continuously redraw. Reconsider rendering strategy if measured limits fail.
- Browser pointer capture, cancellation, blur and teardown replace native gesture ownership. Keyboard handling excludes editable fields. Canvas resize handles device pixels separately from logical coordinates. Browser sans-serif chrome substitutes native fonts; do not claim full application screenshot parity. Omit desktop window/process/filesystem controls.

## Host, backend and database design

- Auth remains in Next.js: pinned Supabase SSR/browser clients, request-scoped server client, `proxy.ts` cookie refresh, public login and callback, safe destination preservation, protected editor verified by `getClaims()`, and logout. No tokens or provider types enter core. Identity updates use the existing neutral contract; signed-out transitions revoke local editing.
- Auth accounts are host infrastructure, not new upstream product roles. A fresh in-memory document has local read/edit capabilities; it is neither an online ownership grant nor membership. Backend enforcement is demonstrated with real denied privileged Auth/API requests; browser roles cannot authorise backend operations.
- Entities: only existing Supabase-managed `auth.users` and sessions are required. No application profile fields are used, so no public profile table is created. No persisted documents, relationships, application indexes, RLS policies, Storage buckets, Realtime publication or retention jobs are needed for unsaved editing. Only the existing public namespace is declared; verify a no-op declarative sync and clean local reset. Future online-file schema must be mapped when selected, not scaffolded here.
- Ownership, memberships, anonymous share links, expiry/revocation/reconnect of shared documents, comments and live undo are outside this slice. Existing contracts remain intact; no capabilities are added. Local undo is per editor instance, never per account. Auth session expiry/sign-out must clear the core identity immediately.
- Hosted MCP connection verified with an actual public-table read. Obtain hosted URL/key without printing credentials; keep local values in ignored env files. Local Supabase ports must not conflict with another project. No hosted schema change required. Hosted Auth callback configuration is a publication prerequisite, not permission to guess a production domain.

## Implementation and verification order

1. Host auth subagent: exact ownership `examples/nextjs/lib/**`, `proxy.ts`, `app/login/**`, `app/auth/**`, host identity adapter and focused tests. Coordinator owns packages, env, editor mounting, CSS and all other files.
2. Coordinator: domain, command transactions, geometry; unit/parity tests, then browser renderer/controller and React chrome.
3. Integrate host identity and signed-out handling; run shared adapters and real local connectivity/denial checks.
4. Run focused/full tests, typecheck, package/Next builds, Playwright primary/error/resize/keyboard/pointer/login/refresh/logout; inspect screenshots and performance. Correct failures before claims or commits.
5. Update stable mapping, scoped changelog, Markdown and self-contained HTML evidence reports. Baseline hash remains unchanged; do not claim full upstream support.
6. Phase 8 only after every required local acceptance row passes. Confirm exact Vercel project/account and clean committed revision; never merge/main/PR without separate authorisation.

Expected files: `src/engine/*`, `src/Editor.tsx`, package exports, Supabase identity adapter, host auth files, preview page/CSS, manifests/lock, local config, `tests/{unit,parity,contracts,integration,e2e}`, parity mapping, setup, changelog and reports. Significant verified commits separate engine, host integration and evidence where practical. Rollback points are those commits; do not revert other contributors' work. No Rust runtime/build/test dependency.

## Phase results

- Phase 1: sync passed; React requested base `5cf5837` had already advanced to `f6450d5` by a prompt-only delegation calibration commit, preserved. Fork, original and parity baseline remain `8eb0b87`. React remote dev matched the actual local starting HEAD.
- Phase 2: bounded rectangle slice, dependency roadmap, mappings, hazards and provider design recorded before implementation.
- Phase 3: actual subagents owned host Auth files and parity fixtures without overlap; coordinator reviewed both and fixed a negative-zero geometry discrepancy exposed by the fixtures.
- Phase 4: implementation complete locally; core committed as `d71b73d`. Hosted Auth settings remain an external permission prerequisite: Management API GET config/auth returned 403 with the current CLI credential. No attempt to bypass that permission or deploy has been made.
- Phase 5: 68 tests including real local Auth, strict library/preview/test typechecking, package and Next.js builds passed. Six Playwright tests passed, including a committed fixed canvas screenshot, 390/700/1440 px resize, pixel checks and Canvas-unavailable error. Reviewed desktop screenshot and corrected no further visual defects.
- Phase 6: separate local ports, clean reset, public table count zero, all local advisers clear. The initial empty-input schema sync refusal was resolved by explicitly declaring the existing public namespace; subsequent sync reported no changes and created no migration. `preview:dev` login/create/logout passed with no page errors. Hosted publishable-key connectivity returned 200; secrets were not committed.
- Performance: 10,000 rectangles / 110 measured frames: p95 1.0 ms, max 1.3 ms. Continuous drawing: pointer p95 0.1 ms, render p95 0.1 ms, no React commits during 40 pointer moves. These are measurements on the recorded test environment, not guarantees for every device.

- Host integration committed as `a84d7a5c3825e616cfadf62ec83ee7c3ded1be79`. Phase 7 reports are `docs/reports/26-11-06-rectangle-slice.md` and `docs/reports/26-11-06-rectangle-slice-parity.html`. Checkpoint intentionally remains Blocked, not Complete: Phase 4.8 hosted Auth configuration is unverified after an explicit 403. Phase 8, branch push, homepage change and deployment were not attempted. No merge or pull request is authorised.

## Resumption — CLI access restored

The renewed CLI credential read the intended Figcraft project’s Auth configuration successfully (HTTP 200), and the scoped MCP project call still succeeded. Hosted Auth had Site URL `http://localhost:3000` and an empty callback allow-list. Added and read-back verified the three repository-configured local callback URLs, preserving Site URL and all other settings. The earlier 403 is resolved. The public Site URL remains a required user decision; no Vercel action or publication has been attempted.

## Resumption — Vercel-assigned URL selected

The user selected whatever stable domain Vercel assigns, authorising the read-only project discovery needed to resolve that URL. Authenticated Vercel account/team inventory and project Git links were checked; no existing project named or linked to `glowplug-studio/figcraft-react` was found. No project was created, linked or retargeted. Phase 8.2 explicitly requires user selection in this case. Proposed target: project `figcraft-react`, repository `glowplug-studio/figcraft-react`, root `examples/nextjs`; build from the monorepo root with `npm run preview:build`. No deployment or push has occurred.
