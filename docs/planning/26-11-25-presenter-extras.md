# Roadmap row 15, item 10f: inspecting, comments and controllers in the presenter

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `34c9421` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-input.ts` (`pads`, `padsHeld`); `src/engine/prototype-screen.ts` (`layerAt`); `src/engine/prototype-player.ts` (`inspected`); `src/engine/comment-query.ts` (a comment's frame no longer skips frames whose visibility is unset); `src/Presenter.tsx` (Inspect and Comments buttons, C and Shift+C, the Inspect outline and panel, comment pins and their thread with replies, controller polling, the bar's thumbnail of the frame); tests `tests/parity/prototype-gestures.test.ts` (two controller cases), `tests/unit/comment-frame.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`ui-egui/src/present/{chrome,player,input}.rs`, `canvas/comments.rs::presenter`)

- **Controllers**: while the prototype has controller triggers and the window has the focus, the player polls the controllers each frame; each button pressed since the last poll plays the key trigger that names it (Gamepad A …), once per press, in button order; held buttons do not repeat; while a link notice shows they are dropped. A prototype without controller triggers never polls.
- **Comments**: the Comments button, C or Shift+C show the presented frame's comment pins, placed by the frame as designed mapped onto it as presented and clipped to what shows; a pin opens its thread, to read and reply.
- **Inspect**: the Inspect button shows a panel beside the prototype naming the layer last under the pointer (the top-most visible layer, `layer_at`), which is outlined in the accent colour; the panel's property sections are Dev Mode inspection (roadmap row 17).
- **Bar thumbnail**: a small picture of the presented frame beside its name in the full-window bar.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `present/chrome.rs::poll_pads`, `present/input.rs::fire_pads` | `prototype-input.ts` `pads`; `Presenter.tsx` | Restated native tests; browser case |
| `canvas/comments.rs::presenter` | `Presenter.tsx`; `comment-query.ts` | Browser case; unit test |
| `present/chrome.rs::{layer_at, inspect_panel}`, `present/player.rs::inspect_hover` | `prototype-screen.ts` `layerAt`; `Presenter.tsx` | Browser case with pixels |
| `present/player.rs::top_bar` (`bar_thumb`) | `Presenter.tsx` `FrameThumb` | Browser case (drawn) |

## Acceptance

- Native's `controller_buttons_play_key_gamepad_triggers` and `prototypes_without_gamepad_triggers_dont_poll` restated and passing; a unit test pins a comment's frame for frames whose visibility is unset (it failed before).
- A browser case shows a comment pin where the comment sits on the presented frame, opens its thread and replies, hides the pins, inspects the layer under the pointer (named in the panel, outlined by pixels), and plays a controller's A button. It failed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
