# Roadmap row 15, item 10f: inspecting, comments and controllers in the presenter

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `792e207`. **This bounded item passes. The Inspect panel's property sections wait for roadmap row 17; the roadmap and the full port remain unfinished.**

## Implemented boundary

- **Controllers.** While the prototype has controller triggers and the page has the focus, the presenter polls the controllers each frame ([`prototype-input.ts`](../../src/engine/prototype-input.ts) `pads`, [`Presenter.tsx`](../../src/Presenter.tsx)). Each button pressed since the last poll plays the key trigger that names it, once per press, in button order, as native's `poll_pads` and `fire_pads` do. Buttons are dropped while a link notice shows.
- **Comments.** The Comments button, C or Shift+C show the presented frame's comment pins. Each pin sits where the comment is on the frame as designed, mapped onto the frame as presented and clipped to what shows (native `comments::presenter`); a pin opens its thread to read and reply.
- **Inspect.** The Inspect button shows a panel beside the prototype naming the layer last under the pointer, the top-most visible one (native `layer_at`), which is outlined in the accent colour.
- **Thumbnail.** The full-window bar shows a small picture of the presented frame beside its name.

Writing the comments case found a bug in the port's comment query: a comment's frame skipped frames whose visibility was unset, which is every frame made by command, so `comment.list {frame}` found nothing. The query now skips only frames that are hidden, as native's `frame_of` does ([`comment-query.ts`](../../src/engine/comment-query.ts)).

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `present/tail_tests.rs`: `controller_buttons_play_key_gamepad_triggers`, `prototypes_without_gamepad_triggers_dont_poll` | Pass |
| Unit test | A comment's frame for frames whose visibility is unset, and none for a hidden frame | Pass; failed before |
| Browser | A comment pin where the comment sits on the frame, its thread with a reply, the pins hidden again; the layer under the pointer named in the Inspect panel and outlined by pixels; a controller's A button playing its trigger | Pass; failed before |

## Recorded differences

- **Inspect panel sections.** Native fills the panel with the Dev Mode inspection sections (`devinspect::properties`); the port has those with roadmap row 17, so the panel names the layer only. The [deferred review queue](../planning/26-11-07-full-port-resume.md) holds the check.
- **Control channel.** Native's control channel can press controller buttons by name or index; the browser port has no control channel. Controllers are read through the browser's Gamepad API.
- **The thread.** The presenter's thread offers reading and replying; reactions, resolving and editing stay in the editor's comments.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/present/chrome.rs::poll_pads`, `present/input.rs::fire_pads` | `prototype-input.ts` `pads`, `Presenter.tsx` |
| `crates/ui-egui/src/canvas/comments.rs::presenter` | `Presenter.tsx`, `comment-query.ts` |
| `crates/ui-egui/src/present/chrome.rs::{layer_at, inspect_panel}`, `present/player.rs::inspect_hover` | `prototype-screen.ts` `layerAt`, `Presenter.tsx` |
| `crates/ui-egui/src/present/player.rs::top_bar` (the bar's thumbnail) | `Presenter.tsx` `FrameThumb` |

[Property matrix](26-11-25-presenter-extras-parity.html) · [Plan](../planning/26-11-25-presenter-extras.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-gestures.test.ts) · [Unit](../../tests/unit/comment-frame.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `792e207`, native reference `bad07e44` |
| Failing fixtures first | The unit test and the browser case failed before |
| Full pure suite | 5,683 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 440 cumulative Chromium cases passed in one 17.4-minute run at `792e207` with zero skips, retries, flakes or suite errors: the 439 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 15.72 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,540 nodes/40,609 edges at `792e207`; native 28,939/92,127 at `bad07e44`; combined 38,479/131,493. `layerAt`, `FrameThumb`, `PresenterInput`, `frameOf` and `finishLinks` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-gestures.test.ts tests/unit/comment-frame.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "presenter shows comments" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- The Inspect panel's property sections (roadmap row 17).
