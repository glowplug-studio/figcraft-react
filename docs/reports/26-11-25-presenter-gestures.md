# Roadmap row 15, item 10c: presenter gestures and overlays in motion

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `f1db0d3`. **This bounded item passes. Items 10d and 10e (scrolling and the screen, the presenter's chrome), the roadmap and the full port remain unfinished.**

## Implemented boundary

The presenter now takes the pointer and keys as native's `input.rs` does, through a controller apart from the drawing ([`prototype-input.ts`](../../src/engine/prototype-input.ts)):

- **Pointer.** A press outside the top overlay closes it when it closes on a click outside; otherwise mouse down fires, then while pressing. A release reverts a while-pressing state, fires mouse up, then on click unless the press dragged.
- **Hover.** Entering and leaving hotspots fire mouse enter and mouse leave. While hovering shows its state while the pointer stays over the layer's place on the screen, and reverts when it leaves.
- **Drags.** A press past the drag threshold starts an on-drag interaction whose transition accepts that direction. The transition follows the pointer, waits while the pointer holds still and plays on from there when released.
- **Keys.** A key trigger of what shows fires first. Then R restarts, and the right arrow, Space and N step forward and the left arrow back through the page's top-level frames while no overlay is open.
- **Timers.** Delayed mouse triggers wait out their delay and fire once, while their screen shows.

The presenter also draws what native's `draw.rs` draws in motion ([`prototype-screen.ts`](../../src/engine/prototype-screen.ts) `overlayLayers`, [`Presenter.tsx`](../../src/Presenter.tsx)):

- Overlays that are opening or closing are drawn over the screen without them. Each sits over its background, faded with the progress, and is moved and faded as its opening transition places it; closing plays that transition backwards.
- A click where nothing reacts flashes the hotspots for half a second.

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `present/behaviour_tests.rs`: `triggers_fire_on_their_gesture` (21 trigger, transition and gesture cases), `nested_hotspots_and_click_through`, `a_click_outside_an_overlay_closes_it_unless_turned_off`, `a_drag_started_transition_follows_the_pointer`; `present/delay_tests.rs`: `mouse_triggers_wait_out_their_delay`, `a_delayed_trigger_fires_once_and_not_on_another_screen` | Pass. The drag case failed first: the transition kept playing while the drag held still |
| Unit tests | The controller over hover in screen space, press, hints, a drag that follows, the keys, and an opening overlay's layer and progress | Pass |
| Browser | While hovering and while pressing revert, mouse enter, R and the arrows, the hotspot hint tint and its clearing, and an overlay moving in from the right mid-way by pixels | Pass; failed before. Its first gate run caught the hints' last faded frame staying on screen, so the presenter draws one frame past them |

## Recorded differences

- **Pointer in page units.** Native measures in screen points; the controller takes page units of the frame showing. It translates the hover area and a drag's start into the frame shown now, so a state that shows another frame behaves as native's does.
- **Z.** The size options open with item 10d; until then Z does nothing.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/present/input.rs` | `prototype-input.ts` `PresenterInput` |
| `crates/ui-egui/src/present/draw.rs` (overlays in motion, hotspot hints) | `prototype-screen.ts` `overlayLayers`, `Presenter.tsx`, `prototype-player.ts` `pruneClosing` |

[Property matrix](26-11-25-presenter-gestures-parity.html) · [Plan](../planning/26-11-25-presenter-gestures.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-gestures.test.ts) · [Unit](../../tests/unit/prototype-input.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `f1db0d3`, native reference `bad07e44` |
| Failing fixtures first | The parity drag case and the browser case failed before |
| Full pure suite | 5,652 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 437 cumulative Chromium cases passed in one 17.5-minute run at `f1db0d3` with zero skips, retries, flakes or suite errors: the 436 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 13.41 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,429 nodes/40,192 edges at `f1db0d3`; native 28,939/92,127 at `bad07e44`; combined 38,368/131,087. `PresenterInput`, `overlayLayers`, `pruneClosing`, `presentedScreen` and `transitionFrames` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-gestures.test.ts tests/unit/prototype-input.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "presenter takes the pointer" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 10d and 10e.
