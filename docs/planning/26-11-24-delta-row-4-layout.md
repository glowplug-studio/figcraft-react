# Upstream delta row 4: layout

## Execution checkpoint

- Phase: items 1 to 3 complete through Phase 7 at `addee52`, `c053caa` and `1ab10c7` ([grid Fill tracks](../reports/26-11-24-grid-fill-tracks.md), [layout snap bounds](../reports/26-11-24-grid-snap-bounds.md), [Align unavailable in an auto layout flow](../reports/26-11-24-align-auto-layout.md)). Item 4 is next. Each item is opened with its own dated plan.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React revision: the row 3 records commit on `prompt/full-figcraft-port`.
- Source queue: row 4 of the [upstream delta queue](26-11-15-upstream-delta.md), range `7bf098d7..bad07e44`, with its commits taken from the [commit ledger](26-11-20-upstream-delta-ledger.md).
- Files in progress: none.
- Native oracle: `$HOME/.cache/figcraft-oracle/project`; `replay` runs command sequences through the pinned engine. Layout results (frame and child sizes after `node.set`) and command refusals are observed through it.
- Next action: open item 4, the auto layout drag reorder (ledger 4.2, upstream `cf567c3f`, `e415a3a0`, #2142): within its own non-wrapping row or column, a dragged child's slot follows the leading edge of the box it would fill (its start bounds, or several layers' combined bounds, moved by the unsnapped drag): forward it passes a sibling whose middle the high edge has passed, backward or with no move along the flow it passes one whose middle lies before the low edge (`crates/engine/src/canvas/drop.rs::auto_layout_slot_within`, `canvas/tools/drag.rs`; port `layout-navigation.ts::prepareAutoLayoutSlot`, `layout-drop.ts::placeMove`, `move-interaction.ts`). Restate native `al_drag_tests`, port, gate and record; then delta row 5.
- Blockers: none. Oracle builds are CPU-heavy; do not run them during a browser gate.

## Why the order

Items the layout engine decides come first, since `replay` observes them directly: grid track sizing, then the snap-line bounds. The Align refusal follows, observed as a command refusal and checked in the Design panel. The drag reorder is a pointer gesture the oracle cannot send, so it comes last and restates native's `al_drag_tests`.

| Item | Ledger | Upstream behaviour | Native files and tests | React files | Status |
|---|---|---|---|---|---|
| 1 | 4.1 | Grid Fill tracks share the space and let a fixed child overflow (`a28c03d9`, `92753a8f`, `daa6b5b2`) | `layout/src/lib.rs`; `layout/src/behaviour_tests.rs` | `grid-layout.ts`, `grid-placement.ts` | Verified at `addee52` with native observations ([plan](26-11-24-grid-fill-tracks.md)) |
| 2 | 4.4 | Layout bounds: a grid that would pass the snap budget is left out; the snap lines a frame's grids make are bounded (`9d486259`, `1935c3ea`) | `layout/src/lib.rs`; `layout/src/depth_tests.rs` | `layout-guides.ts`, the snapping in `arrange.ts` | Verified at `c053caa` with native observations ([plan](26-11-24-grid-snap-bounds.md)) |
| 3 | 4.3 | Align is unavailable for a layer in an auto layout frame's flow (`76965c78`) | `engine/src/cmd/arrange.rs`, `ui-egui/src/panels/right.rs`; `engine/src/al_behaviour_tests.rs`, `ui-egui/src/canvas/selection_cache_tests.rs` | `arrange.ts`, `ArrangePanel.tsx` | Verified at `1ab10c7` with native observations ([plan](26-11-24-align-auto-layout.md)) |
| 4 | 4.2 | A child dragged in auto layout passes a sibling when its leading edge reaches the sibling's middle (#2142; `cf567c3f`, `e415a3a0`) | `engine/src/canvas/drop.rs`, `canvas/tools/drag.rs`; `engine/src/al_drag_tests.rs` | `layout-drop.ts` | Next; upstream commits read |

## Acceptance per item

Native observations recorded with provenance where `replay` reaches the behaviour, restated native tests where it does not; each new case fails without its change; the full pure suite, strict types, both builds, the cumulative browser gate, provider integrations once, zero fixture counts and the local graph pass before the item is recorded.
