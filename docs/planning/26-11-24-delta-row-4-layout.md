# Upstream delta row 4: layout

## Execution checkpoint

- Phase: items 1 to 1 complete through Phase 7 at `addee52` ([grid Fill tracks](../reports/26-11-24-grid-fill-tracks.md)). Item 2 is next. Each item is opened with its own dated plan.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React revision: the row 3 records commit on `prompt/full-figcraft-port`.
- Source queue: row 4 of the [upstream delta queue](26-11-15-upstream-delta.md), range `7bf098d7..bad07e44`, with its commits taken from the [commit ledger](26-11-20-upstream-delta-ledger.md).
- Files in progress: none.
- Native oracle: `$HOME/.cache/figcraft-oracle/project`; `replay` runs command sequences through the pinned engine. Layout results (frame and child sizes after `node.set`) and command refusals are observed through it.
- Next action: open item 2, layout snap bounds (ledger 4.4, upstream `9d486259`, `1935c3ea`): the snap lines a frame's grids give together are bounded at 200,000, and a grid that would pass the budget is left out whole (`crates/layout/src/lib.rs::grid_snap_lines_in`, `MAX_SNAP_LINES`; port `snapping.ts::SnapTargets`). Restate native `depth_tests::snap_lines_are_bounded_across_a_frames_grids`, port, gate and record.
- Blockers: none. Oracle builds are CPU-heavy; do not run them during a browser gate.

## Why the order

Items the layout engine decides come first, since `replay` observes them directly: grid track sizing, then the snap-line bounds. The Align refusal follows, observed as a command refusal and checked in the Design panel. The drag reorder is a pointer gesture the oracle cannot send, so it comes last and restates native's `al_drag_tests`.

| Item | Ledger | Upstream behaviour | Native files and tests | React files | Status |
|---|---|---|---|---|---|
| 1 | 4.1 | Grid Fill tracks share the space and let a fixed child overflow (`a28c03d9`, `92753a8f`, `daa6b5b2`) | `layout/src/lib.rs`; `layout/src/behaviour_tests.rs` | `grid-layout.ts`, `grid-placement.ts` | Verified at `addee52` with native observations ([plan](26-11-24-grid-fill-tracks.md)) |
| 2 | 4.4 | Layout bounds: a grid that would pass the snap budget is left out; the snap lines a frame's grids make are bounded (`9d486259`, `1935c3ea`) | `layout/src/lib.rs`; `layout/src/depth_tests.rs` | `layout-guides.ts`, the snapping in `arrange.ts` | Next; upstream commits read |
| 3 | 4.3 | Align is unavailable for a layer in an auto layout frame's flow (`76965c78`) | `engine/src/cmd/arrange.rs`, `ui-egui/src/panels/right.rs`; `engine/src/al_behaviour_tests.rs`, `ui-egui/src/canvas/selection_cache_tests.rs` | `arrange.ts`, `ArrangePanel.tsx` | Not started |
| 4 | 4.2 | A child dragged in auto layout passes a sibling when its leading edge reaches the sibling's middle (#2142; `cf567c3f`, `e415a3a0`) | `engine/src/canvas/drop.rs`, `canvas/tools/drag.rs`; `engine/src/al_drag_tests.rs` | `layout-drop.ts` | Not started |

## Acceptance per item

Native observations recorded with provenance where `replay` reaches the behaviour, restated native tests where it does not; each new case fails without its change; the full pure suite, strict types, both builds, the cumulative browser gate, provider integrations once, zero fixture counts and the local graph pass before the item is recorded.
