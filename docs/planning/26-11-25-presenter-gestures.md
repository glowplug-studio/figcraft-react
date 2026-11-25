# Roadmap row 15, item 10c: presenter gestures and overlays in motion

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `f1db0d3`: [report](../reports/26-11-25-presenter-gestures.md), [matrix](../reports/26-11-25-presenter-gestures-parity.html).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `a2586b6` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-input.ts` (new: `PresenterInput` with `move`, `down`, `up`, `key`, `tick`); `src/engine/prototype-screen.ts` (`presentedScreen` without overlays, `overlayLayers`); `src/engine/prototype-player.ts` (`pruneClosing`); `src/Presenter.tsx` (pointer down, move, up and leave through the controller, overlays drawn in motion, hotspot hints); tests `tests/parity/prototype-gestures.test.ts`, `tests/unit/prototype-input.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded. Item 10d follows in the row plan.
- Blockers: none.

## Native contract (`ui-egui/src/present/{input,draw}.rs`)

- **Pointer**: a press outside the top overlay closes it when it closes on a click outside; otherwise mouse down fires, then while pressing. A release reverts a while-pressing state, fires mouse up, then on click unless the press dragged; a click where nothing reacts shows hotspot hints for half a second.
- **Hover**: entering and leaving hotspots fire mouse enter and mouse leave; while hovering shows its state while the pointer stays over the layer's place on the screen and reverts when it leaves. The place is in screen space, so a state showing another frame keeps it.
- **Drag**: a press that moves past the threshold starts an on-drag interaction whose transition accepts that direction. The transition it starts follows the pointer along its direction (else the drag's main axis), measured against the screen's length that way, waits while the pointer holds still and plays on from there when released.
- **Keys**: a key trigger of what shows fires first; then R restarts, Z opens the size options (item 10d), and the right arrow, Space and N step forward and the left arrow back through the page's top-level frames while no overlay is open.
- **Timers**: delayed mouse triggers fire when due while their screen shows; an after-delay interaction fires when due, not while a transition plays.
- **Drawing**: overlays opening or closing are drawn apart over the screen without them, each over its background faded with the progress, moved and faded as their opening transition places them (closing plays it backwards); instant overlays show whole.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `present/input.rs` (pointer, hover, drag and follow, keys, timers) | `prototype-input.ts` `PresenterInput` | Restated native behaviour tests; unit tests; browser case |
| `present/draw.rs` (overlays in motion, hotspot hints) | `prototype-screen.ts` `overlayLayers`; `Presenter.tsx`; `prototype-player.ts` `pruneClosing` | Unit test; browser case with pixels |

## Acceptance

- Native's `triggers_fire_on_their_gesture`, `nested_hotspots_and_click_through`, `a_click_outside_an_overlay_closes_it_unless_turned_off`, `a_drag_started_transition_follows_the_pointer`, `mouse_triggers_wait_out_their_delay` and `a_delayed_trigger_fires_once_and_not_on_another_screen` restated and passing (the drag case caught a transition that kept playing while the drag held still); unit tests drive the controller over hover in screen space, press, hints, drags, keys and an opening overlay.
- A browser case presents a flow and checks while hovering and while pressing revert, mouse enter, R and the arrows, the hotspot hint tint and an overlay moving in mid-way by pixels. It failed before; its first gate run caught the hints' last faded frame staying on screen, so the presenter draws one frame past them.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
