# Roadmap row 15, item 7c: the player's state

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `425309f`: [report](../reports/26-11-25-prototype-player-state.md), [matrix](../reports/26-11-25-prototype-player-state-parity.html).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `e28d7c0` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-scroll.ts` (new: `pageDevice`, `viewport`, `scrollRangeIn`, `scrollRange`, `clampScroll`, `fitViewport`, `applyScroll`, `raiseFixed`, `scrollToLayer`); `src/engine/prototype-player.ts` (new: `PrototypePlayer`); test `tests/parity/prototype-player-state.test.ts`.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract

- **`ui-egui/src/present/scroll.rs`**: how far a frame scrolls (its overflow's axes; a top-level frame on a device scrolls through its whole size), the device's viewport, the display copy sized to the screen with fixed layers following their constraints, scroll offsets applied (fixed layers stay, sticky ones stop at the edge), fixed layers raised above the content, Scroll to bringing every scrolling frame around a layer to it.
- **`present.rs`, `present/navigate.rs`**: the player follows the editor's document (copying it when it changes, keeping the screen, overlays and scroll offsets that still exist, going back to the start when the screen is deleted), arrives at frames (remembering sections, clearing timers), keeps history for Back, restarts with the document as edited, reverts a hover or press state with the transition played back, closes overlays animating out from where they got to, and times after-delay interactions from when the screen arrived or the overlay opened.
- **`present/actions.rs`**: delayed mouse triggers wait while their screen shows; each action does what native's does, conditional branches evaluated after earlier actions, nesting cut at 16; opened links kept only for web and mail addresses, the viewer's own only when their click, press, drag or key fired them.

## The port

`PrototypePlayer` restates the state machine without drawing: the presenter (item 10) draws the display document, plays `anim` and `scrollAnim`, and feeds pointer, key and timer input. Two parts wait for the presenter: a responsive prototype resizing its frame to the screen (native `respond`), and the reflow native runs after an action changes layers beyond re-applying variable bindings (text resizing to what it shows, auto layout reflowing); `Change to` rebuilds the instance with the port's instance sync.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `ui-egui/src/present/scroll.rs` | `prototype-scroll.ts` | Restated `scroll_offsets_fixed_and_sticky`, `device_screen_clips_the_frame_and_it_scrolls_through_its_height`, `scroll_to_moves_every_scrolling_frame_around_the_layer` |
| `ui-egui/src/present.rs`, `present/navigate.rs` | `prototype-player.ts` `sync`, `go`, `restart`, `revert`, `closeOverlay`, `nextDelay` | Restated `closed_overlays_animate_out_unless_instant`, `navigating_resets_scroll_unless_it_preserves_it`, `sync_follows_edits_and_keeps_the_screen` |
| `ui-egui/src/present/actions.rs` | `prototype-player.ts` `fire`, `gesture`, `fireWaiting`, `perform` | Restated `variables_tests.rs` (four cases); four cases following native's code for timers, reverting and links |

## Acceptance

- Ten restated native cases and four following native's code pass; they failed before (no player).
- No browser case: the presenter (item 10) takes it, in the deferred queue.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
