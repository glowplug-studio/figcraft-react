# Pen and open-path authoring

React0.27.0 on `prompt/full-figcraft-port`. Reviewed base `4a762cd`, internal network/edit-mode foundation `653e4a4`; verified integration `d3c00a4`. Reference `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; global parity baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`. Full parity and publication remain incomplete.

## Implemented

New Pen paths retain one engine transaction across clicks and pointer releases. The first anchor chooses its frame; analytical cubic bounds and relative handles preserve page placement beneath transformed parents. Open vectors have a black centred stroke and no fill; closing adds the native shape fill. Interior-anchor joining, duplicate-last suppression, selected endpoint continuation and 45° placement preserve native behaviour.

Edit-mode Pen creates, connects, branches and splits within the active network, one undo per click. Closing drags mirror handles on both sides of eligible endpoints. Commands preserve native identifiers and parameter/coordinate contracts. Ordered adjacency supplies native shortest-chain closure without repeated whole-network scans. Cached snapping targets preserve object/pixel preferences, Ctrl/⌘ suppression and immutable-document invalidation.

Escape finishes a new path into edit-mode Pen; the next path belongs to the same layer. Enter/double-click selects edit-mode Move. Edit-mode double-click removes an accidental new point/split before switching tools. Whole-path undo, per-click undo, tool switches, pointer cancellation, identity revocation, finite geometry failures, save/recovery and mobile controls are covered. Engine previews notify Canvas only; React subscribes to committed state.

## Verification

- 803 pure tests pass:40 new paired Pen fixtures across network/commands, edit-mode pointer, new-path geometry and path lifetime. Two real Auth tests pass separately against local Supabase.
- Strict package/tests/Next TypeScript and package/Next production builds pass after both browser fixtures and the final Scale-anchor correction.
- Both new authenticated browser workflows pass: creation/drag/one-step undo, disconnected edit-mode continuation, Enter/Escape, closure, endpoint resume, double-click, cancellation, native download, recovery and mobile bounds. Fixed desktop and mobile captures inspected.
- Three performance fixtures pass with10,000 total nodes,100 visible vector layers and110 measured frames after10 warm-ups. Final combined p95/max/input p95: hover0.9/1.5/0.1ms; draw5.8/5.9/4.9ms; edit2.9/3.2/2.2ms. All record zero root/panel preview notifications and exact cancellation. The16.7ms gate is unchanged.
- The67-test authenticated regression passes in119.9s with no failures, skips or flakes. All11 changed prior captures differ only in controls: bottom Pen toolbar, plus118 top-control pixels in the point-box capture. Canvas geometry is unchanged. The final97-check no-update Chromium regression passes in231.3s with zero failures, skips or flakes, against the final production build.

Node24.20.0, TypeScript7.0.2, React19.3.1, Next16.4.5, Playwright1.65.0. Fixed viewport1440×900/DPR1; mobile390×844. Main library632.67kB/gzip176.30kB in the final0.27.0 build; this is neither the full Next download nor browser RAM. Full-host memory, large visible images/text/effects and long-session stability remain required at final audit.

## Corrections, substitutions and dependencies

The first browser attempt incorrectly waited for recovery to be saved on an untouched empty document. It correctly reported “Local recovery ready”; the fixture now asserts that initial state before drawing. The subsequent flow passes. Source review also corrected the native overlay order and edit-mode dashed rubber band; the rebuilt-host focused checks pass afterwards. The Scale-anchor preference command now preserves an open Pen transaction, including read/write/invalid-value checks; it is not a tool transition. No product or performance threshold was relaxed.

Browser pointer capture, labelled native HTML tool buttons and Canvas overlays replace egui input/widgets. Standard browser cursor cues indicate new/add/connect actions; full native icon/chrome parity remains in the master UI slice. Prototype/Inspect mode-switch integration remains required when those modes land. Native process/window behaviour is outside this browser tool scope. No Rust code is executed, imported or bundled.

Local malformed/non-finite input cancels an uncommitted Pen preview atomically. Existing browser command boundaries cancel unrelated transient edits; view switches preserve the open path, tool switches commit it, and native save commits the path before serialising. The core retains provider-neutral identity/access boundaries. No new profile, role, ownership, schema, RLS, Storage or Realtime operation is introduced by this geometry workflow.

## Infrastructure and continuation

Upstream sync succeeds unchanged at0b97f3f. Both authorised Graphify repositories are queryable; Rust maps the pinned Pen definitions/tests, while hosted React remains four README nodes atb3b8a1b. Current local source is authoritative. Local AST refreshed to1,676 nodes/7,938 edges, with two SQL parser omissions and one symbol-free performance test. Scoped Supabase MCP public-table read succeeds with no application tables; online files and collaboration remain mandatory future roadmap work.

The46-row HTML report renders locally with13 columns and no broken evidence links; public-file hygiene and whitespace checks pass. The owned Next process was stopped cleanly. Integration is committed as `d3c00a4`; continue immediately with Pencil and dependent vector operations. No deployment, branch push, main merge or user action. The full product is not complete.

See the [property matrix](26-11-07-pen-authoring-parity.html), [plan](../planning/26-11-07-pen-authoring.md) and [master checkpoint](../planning/26-11-06-complete-figcraft-port.md).

During next-slice evidence gathering, the authorised upstream sync advanced the reference submodule to09e04e71765517975950403eec4cb6fbe8955359. Pen/Pencil engine sources and existing Pen test sources are unchanged. This Pen verification remains against the stated0b97f3f evidence; the incoming product changes require their own mapped follow-up and do not advance the global parity baseline.
