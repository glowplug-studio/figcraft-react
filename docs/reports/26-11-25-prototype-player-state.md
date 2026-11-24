# Roadmap row 15, item 7c: the player's state

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `425309f`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

The presenter needs a player that knows what shows and what each input does. [`prototype-player.ts`](../../src/engine/prototype-player.ts) restates native's player state without drawing: following edits, navigation and history, Back, overlays opening, swapping and closing (animating out from where they got to), hover and press states that revert, delayed mouse triggers and after-delay timers, Scroll to, variable actions and conditionals, Change to, and the links a prototype opens (web and mail only, the viewer's own only when their input fired them). [`prototype-scroll.ts`](../../src/engine/prototype-scroll.ts) restates what scrolls and how far, the device's viewport, fixed and sticky layers.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| Restated native tests | `present/tests.rs` (overlays closing, fixed and sticky scrolling, device screens, Scroll to, navigation and scroll, following edits), `present/variables_tests.rs` (counter and conditional navigation, modes, nesting, stored collection ids) | Ten cases pass; they failed before (no player) |
| Cases following native's player code | Delayed mouse triggers, reverting hover states, after-delay timers, opened links | Four cases pass |

No native observation file: the cases restate native's own tests and code.

## Recorded differences

- **Waiting for the presenter.** A responsive prototype resizing its frame to the screen, and the reflow native runs after an action changes layers (text resizing, auto layout), come with the presenter (item 10), which also takes the browser case.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/present/scroll.rs` | `prototype-scroll.ts` |
| `crates/ui-egui/src/present.rs`, `present/navigate.rs`, `present/actions.rs` | `prototype-player.ts` `PrototypePlayer` |

[Property matrix](26-11-25-prototype-player-state-parity.html) · [Plan](../planning/26-11-25-prototype-player-state.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-player-state.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `425309f`, native reference `bad07e44` |
| Failing fixtures first | The parity cases failed before |
| Full pure suite | 5,626 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 431 cumulative Chromium cases passed in one 17.5-minute run at `425309f` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed in 13.66 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,244 nodes/39,334 edges at `425309f`; native 28,939/92,127 at `bad07e44`; combined 38,183/130,240. `PrototypePlayer`, `scrollRangeIn`, `applyScroll`, `scrollToLayer` and `fitViewport` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-player-state.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 8 to 10.
