# Roadmap row 15, item 10a: the presenter

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `a793eaa`. **This bounded item passes. Item 10b (the presenter's transitions, gestures, scrolling and chrome), the roadmap and the full port remain unfinished.**

## Implemented boundary

Present and Preview now open native's presenter ([`Presenter.tsx`](../../src/Presenter.tsx)): the full-window presenter or the preview pane plays the prototype player of item 7c, drawing the presented frame and its open overlays, each placed by its preset, by its preset on the layer that opened it, or manually, over its background ([`prototype-overlays.ts`](../../src/engine/prototype-overlays.ts), [`prototype-screen.ts`](../../src/engine/prototype-screen.ts)), scaled down to fit and centred on the page's prototype background. Clicks reach the top-most hotspot of what shows; a click outside the top overlay closes it when it should; keys fire key triggers; after-delay interactions and delayed mouse triggers fire when due; the bar names the flow and frame and has Restart, Present (in the pane) and Close; Escape closes the full-window presenter, which takes the keyboard while it shows.

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `proto_overlay_anchor_tests.rs` (outside and inside presets on the trigger, no preset offset for the screen or manual); `present/tests.rs` `overlay_positions` | Pass; failed before |
| Browser: presenting a flow | The frame drawn white on #1E1E1E; a click navigating; a key going back; an overlay opened, kept by a click on it and closed by one outside; Restart; Escape; the preview pane opened and closed | Pass; failed before (no presenter) |

## Recorded differences

- **Item 10b.** Transitions and smart animate, hover, press and drag gestures, scrolling and flings, device bodies, the scale options, responsive frames, hotspot hints, Inspect, Hide UI, the link notice, comments and controllers come with item 10b; until then every change shows at once.
- **Pane placement.** The preview pane is a panel over the canvas's lower right corner; native floats it over the canvas where it was last put.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/proto.rs::OverlayAnchor::offset`, `crates/ui-egui/src/present/transition.rs::overlay_rect`, `present.rs::anchored_overlay_rect` | `prototype-overlays.ts` |
| `crates/ui-egui/src/present.rs`, `present/{player,layout,input,draw}.rs` | `Presenter.tsx`, `prototype-screen.ts` |

[Property matrix](26-11-25-presenter-parity.html) · [Plan](../planning/26-11-25-presenter.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-overlays.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `a793eaa`, native reference `bad07e44` |
| Failing fixtures first | The parity and browser cases failed before |
| Full pure suite | 5,637 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | Of 435 cumulative Chromium cases, 427 passed in one 21.1-minute run at `a793eaa`'s source; eight 10,000-node frame-budget cases (nested groups and frames, layout reorder and gap drag, move and Alt-copy previews, affine rectangles) failed while the load average fell from about 45 (the preceding builds) and macOS media analysis ran, the same family that fails under that load at code which passed every case at a normal load: environmental under the standing load rule. No baseline changed |
| Real local provider integrations | 32 passed in 13.47 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,366 nodes/39,889 edges at `a793eaa`; native 28,939/92,127 at `bad07e44`; combined 38,305/130,792. `Presenter`, `presentedScreen`, `hotspotAt`, `anchoredOverlayRect` and `keyTarget` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-overlays.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "the presenter plays a flow" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 item 10b: the presenter's transitions, gestures, scrolling and chrome.
