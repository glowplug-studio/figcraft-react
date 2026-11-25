# Roadmap row 15, item 10d: presenter scrolling and the screen

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `c074057`. **This bounded item passes. Item 10e (the presenter's chrome), the roadmap and the full port remain unfinished.**

## Implemented boundary

The presenter is now laid out as native's `layout.rs` lays it out ([`prototype-layout.ts`](../../src/engine/prototype-layout.ts)):

- **On its device.** The presented frame sits on its device's screen, with the whole device sized by the scale option, else on the frame alone. Fit and 100% keep the chrome's padding, and Fit never goes above 100%. What is bigger than the window pans, starting centred across and at the top. The preview pane always fits.
- **Scale options.** Z cycles fit, fit width, fill and 100%; a device offers no fit width, and a responsive frame that fills the window has none.
- **Responsive frames.** A responsive frame is resized to the device's screen, or without a device to the whole window at 100%, with its constraints and auto layout responding; the file keeps its frame.

Scrolling follows native's `scroll.rs` and `input.rs` ([`prototype-scroll.ts`](../../src/engine/prototype-scroll.ts), [`prototype-input.ts`](../../src/engine/prototype-input.ts), [`prototype-player.ts`](../../src/engine/prototype-player.ts)):

- The wheel scrolls the innermost frame under the pointer that can still move, else pans the view, and coasts on when it stops.
- A drag that starts no transition scrolls with a rubber band past the ends and flings on release, springing back from past an end. On a phone or tablet a drag never pans the view.
- A press catches a fling.

The device is drawn in code, as native's `device.rs` draws it ([`presenter-device.ts`](../../src/presenter-device.ts)): the body in the device's colour, black glass, side buttons, a laptop's base, a desktop's stand, rounded screen corners and a phone's camera pill.

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `present_view_tests.rs`: the fling, rubber band and scale option cases, scaling and panning, devices turning and hiding their body, momentum and springing back, the wheel's coast. `proto_responsive_tests.rs`: responsive frames live, filling the window, custom sizes. `present/tests.rs`: the device picker reflowing, presets at their real resolution, a phone scrolling only what overflow allows | Pass. Thirteen cases |
| Browser | An iPhone 16 in Pink: the screen, the glass and the body by pixels; the wheel and a drag scroll the content; Z fills the window | Pass; failed before (no device) |

## Recorded differences

- **Pointer speed.** Native takes a drag's release speed from egui's pointer velocity; the port measures it over the pointer's last 0.1 seconds, which gives the same speed for the same motion.
- **Wheel steps.** Browsers deliver a mouse wheel's notch in one event, where egui smooths it over frames; the scrolled distance is the same.
- **Device picker.** The presenter's navigation bar, where native picks a device, comes with item 10e; the restated cases set the device with the same command the picker runs.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/present/layout.rs`, `present.rs::PresentScale` | `prototype-layout.ts` |
| `crates/ui-egui/src/present/scroll.rs` | `prototype-scroll.ts`, `prototype-player.ts` |
| `crates/ui-egui/src/present/input.rs` (wheel, drag scroll, Z) | `prototype-input.ts` |
| `crates/ui-egui/src/present/navigate.rs::respond_to`, `crates/engine/src/cmd/proto.rs::respond` | `prototype-player.ts` |
| `crates/ui-egui/src/present/device.rs` | `presenter-device.ts`, `Presenter.tsx` |

[Property matrix](26-11-25-presenter-screen-parity.html) · [Plan](../planning/26-11-25-presenter-screen.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-presenter-view.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `c074057`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,665 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 438 cumulative Chromium cases passed in one 17.1-minute run at `c074057` with zero skips, retries, flakes or suite errors: the 437 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 14.01 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,508 nodes/40,486 edges at `c074057`; native 28,939/92,127 at `bad07e44`; combined 38,447/131,378. `presentLayout`, `flingAxis`, `rubberBand`, `drawDeviceBody` and `respondTo` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-presenter-view.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "shows the device round" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 item 10e.
