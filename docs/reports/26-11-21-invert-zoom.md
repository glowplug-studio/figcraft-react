# Upstream delta row 2, item 15: the Invert zoom direction preference

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `7648788`. **This bounded item passes. Four items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `6fce958a` added a preference that reverses wheel zoom.

- **The command.** [`pref.invertZoom`](../../src/engine/editor.ts) sets the preference with `on` and toggles it otherwise; an unknown parameter is refused.
- **The wheel.** [`wheelView`](../../src/engine/viewport.ts) decides what a wheel event does. With the preference on, Ctrl or Cmd with the wheel zooms the other way by the same factor. A trackpad pinch and scrolling are unchanged, and so are the zoom commands and buttons.
- **The checkbox.** Preferences in the File menu has [Invert zoom direction](../../src/InvertZoomPreference.tsx). Its value is saved in the browser, off as well as on, and applied when the editor opens.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-invert-zoom.json](../../tests/fixtures/native-invert-zoom.json) | Two command sequences: the preference toggled, set, given lenient and unreadable values and an unknown parameter; and the zoom commands with it on | Both match, the refusal's message included. Neither could run before the change: the port had no such command |

[Provenance and reproduction](../../tests/fixtures/native-invert-zoom.provenance.md).

The wheel is handled in native's interface crate, which the oracle does not drive. Three port tests restate `crates/ui-egui/src/canvas/wheel_zoom_tests.rs` at `wheelView`: Cmd and Ctrl with the wheel zoom the other way by the reciprocal factor and keep the point under the pointer; a pinch is unchanged in both directions; scrolling is unchanged.

## Recorded differences

- **A pinch is recognised by the Control key.** A browser reports a trackpad pinch as a wheel event with `ctrlKey` set, so the canvas tracks whether a Control key is down and treats `ctrlKey` without one as a pinch. Native is told the source of the gesture. If the browser does not deliver the key press, for example when the page has no keyboard focus at all, Ctrl+wheel is taken for a pinch and is not reversed.
- **No Scroll wheel zoom preference.** Native's other wheel preference is not in the port, so a plain wheel always scrolls and the "plain mouse wheel with Scroll wheel zoom on" half of the native rule has nothing to apply to. The general Preferences window belongs to the interface row.
- **Saved in the browser.** Native saves preferences in its settings file; the port saves this one in local storage, per browser.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/prefs.rs` `invert_zoom`; `crates/engine/src/cmd/view.rs` `pref.invertZoom` | `editor.ts` `invertZoom` and the `pref.invertZoom` case |
| `crates/ui-egui/src/canvas/input.rs` wheel handling and `invert_zoom_factor` | `viewport.ts::wheelView`; `canvas.ts` wheel and Control key tracking |
| `crates/ui-egui/src/dialogs.rs` checkbox | `InvertZoomPreference.tsx`, in `Editor.tsx`'s Preferences |

[Property matrix](26-11-21-invert-zoom-parity.html) · [Plan](../planning/26-11-21-invert-zoom.md) · [Preference parity](../../tests/parity/invert-zoom.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `7648788`, native reference `bad07e44` |
| Failing fixtures first | Both sequences and the wheel tests could not run before the change: the command and `wheelView` did not exist |
| Full pure suite | 5,388 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 402 cumulative Chromium cases passed in one 16.2-minute run with zero skips, retries, flakes or suite errors: the 401 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.54 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,735 nodes/37,349 edges at `7648788`; native 28,939/92,127 at `bad07e44`; combined 37,674/128,304. `wheelView`, `InvertZoomPreference`, `invert_zoom_factor` and `swap_wheel` verified. |

## Reproduction

```sh
npx vitest run tests/parity/invert-zoom.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The differences recorded above.
- Cmd with the wheel is covered by the wheel tests; the browser case uses Ctrl.
- A real trackpad was not used: the browser case sends the wheel event a pinch produces.
- Row 2's last four items (16 to 19) change the Layers panel, the sidebars and the menus. The port's layer list has no icon and no rename, its sidebars do not resize and its menus open on a click, so those four are recorded against the interface row next, and the queue moves to row 3.
