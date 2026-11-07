# Undo and redo anchors while drawing with Pen

## Execution checkpoint

| Field | Value |
|---|---|
| Status / phase | Active; Phase 1–3 evidence, mapping and sequential decomposition complete; implementation next |
| React branch / base | `prompt/full-figcraft-port` at `12a7671`; verified Pencil implementation `7ad8a5a` |
| Reference / global baseline | Fork/original/submodule `7522c39ba594ed7e948b6d2626210c4a36b03497`; global `8eb0b87646c5aef712326d6c431ccde5408630de` unchanged |
| Tests last passed | Prior slice: 848 pure, two real Auth, strict package/tests/Next, production builds, 102 Chromium checks (219.9s); no new Pen undo claim yet |
| Files in progress | Incoming reference report/gitlink, this plan, master checkpoint. No new Pen undo implementation yet. |
| Blockers | None. Both Graphify repositories and scoped Supabase MCP responded. Hosted graphs lag the pin. |
| Exact next action | Implement transient anchor undo/redo stack, command precedence, targeted history controls and paired lifetime tests; verify keyboard/button/native files and full regression. |
| Updated | 2026-11-07T08:56+07:00 |

## Evidence and acceptance

Upstream `0e6fcf9b` changes an already ported behaviour. During an open new Pen path, Undo pops just its newest complete anchor (position and incoming/outgoing handles) onto a path-local redo stack. Three anchors become two with one segment; two become one with no document layer; the final undo clears the path without consuming earlier document history. Only the following undo consumes an earlier document edit. Redo on a nonempty open path restores the last removed anchor, in order. A new accepted anchor clears the path redo stack; ignored duplicate clicks do not. Finish/close/cancel discards this transient stack. A completed path is still one document undo. Existing edit-mode Pen and Pencil retain their own history semantics.

| Upstream source / evidence | Independent TypeScript target | Verification |
|---|---|---|
| `canvas/tools.rs::PenPath.undone`; `tools/pen.rs::pen_down` | `PenInteraction` owns removed `PenAnchor` tuples, clears only on accepted placement | Restore curved handles, branch from undo, duplicate-last click, no document history per anchor |
| `pen.rs::pen_undo`, `pen_redo`, `pen_update`, `pen_finish` | Path controller rebuilds the preview; cancels its document interaction below two points; keeps one remaining anchor and frame; clears overlay/drag state | Paired `undo_while_drawing_takes_back_one_anchor`, handle/overlay/parent and pointer-held cases |
| `session/undo.rs::undo,redo`, `cmd/edit.rs::edit.undo,edit.redo` | `EditorEngine.execute` gives active path first refusal before ordinary history/cancellation; preserve return booleans | Earlier rectangle history, empty redo, interleaved ordinary document redo and read-only transition; no silent consumption |
| `catalog.rs` Undo/Redo, normal key routing and existing host toolbar | Editor keyboard/toolbar dispatch; captured dragging ends on anchor undo; history availability subscribes only in the small controls | Authenticated Ctrl/⌘+Z / Shift+Z, button enablement, redo branch invalidation, finishing/file snapshot, mobile control bounds |

`pen_undo_tests.rs` is read in full. `undo_depth()` still reports document history, not transient anchors. Do not put pointer movement or the anchor array into root React state; publish small button-availability changes only when its booleans change. The host's existing Undo/Redo buttons must remain usable on a blank document's first Pen anchor. Compare normal history fallback separately from eligible anchor redo. Retain one transaction for finished path and frame placement. Clear the drag/rubber state before pointer-up can reapply a removed anchor. Source `pen_redo` declines when there is no removed anchor; a genuinely available document redo must not be lost.

Both named Graphify repositories are queryable: Rust 26,788 nodes indexed at `09e04e71`, before the incoming change; React 4 README nodes at `b3b8a1b`. Natural-language queries yielded stale or ungrounded results. Current source and the new paired native fixture determine behaviour. Scoped Supabase MCP read returned no public application tables. This is local editing only: no schema, rows, RLS, profiles, ownership, grants, Storage, Realtime or Auth configuration change. Host sign-out/revocation must still discard the transient path; live per-client history remains a separate roadmap dependency.

## Sequence and gates

1. Implement Pen-local history, command dispatch and capture handling. Keep old fixtures for completed paths and update the intentionally superseded open-path expectation.
2. Add paired engine fixtures and authenticated keyboard/toolbar flows, including handles, one-anchor threshold, document history and native save/recovery. Check root/panel notifications and existing 10,000-node Pen performance gates.
3. Run all pure, real Auth, strict TypeScript, package/Next production and Playwright checks, inspect fixed screenshots, then write MD/13-column HTML evidence, mapping, changelog/version and checkpoint. Roll back to `12a7671` if needed. User requires canonical sequential work; no subagents, partial publication or main merge.
4. Reconcile incoming drawing/moving/resizing snap priority and command validation before declaring the newer upstream supported. Continue width-point editing and all other roadmap families. The [incoming reference report](../reports/26-11-07-upstream-editor-advance.md) assigns other changes to their owning slices.
