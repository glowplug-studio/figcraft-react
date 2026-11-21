# Upstream delta row 2, item 14: Zoom to selection

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `bac8b73`. **This bounded item passes. Five items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `fceb6063`, `5d529269` and `53bf0a40` changed Zoom to selection to what upstream measured in the target application: the selection is fitted into the canvas above the floating bottom toolbar with a 40 point margin on every side, centred in that area. The port used the Zoom to fit rule, a 64 point margin in the whole canvas, so a fitted selection could end behind the toolbar.

- [`fitSelection`](../../src/engine/viewport.ts) ports native's `fit_selection`. When 40 points do not fit, the margin is a quarter of the area. A point is centred in the area at the zoom the view has.
- The view has an unsaved bottom inset: the height of the strip the toolbar covers. `view.set bottomInset` sets it and `view.get` does not give it back.
- The [editor](../../src/Editor.tsx) measures the toolbar over the canvas and hands the strip to the engine ([`setBottomInset`](../../src/engine/editor.ts)); it is 0 when the toolbar does not lie over the canvas.
- Zoom to fit is unchanged.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-zoom-selection.json](../../tests/fixtures/native-zoom-selection.json) | Eleven command sequences: canvases of several sizes with and without the strip, wide, tall, tiny and huge selections, a line, nothing selected, Zoom to fit and the inset's limits | All eleven match: zoom and centre to nine decimals. All eleven failed before the change, ten because `view.set` did not know the inset |

[Provenance and reproduction](../../tests/fixtures/native-zoom-selection.provenance.md).

## One earlier expectation changed

`viewport.test.ts` expected Zoom to selection of a 40 by 40 layer in a 1200 by 800 canvas to give a zoom of 16.8, the 64 point margin. The same scene observed natively gives 18, (800 - 80) / 40. The test states that now.

## Recorded differences

- **When the inset is measured.** Native sets it every frame. The port measures when the toolbar or the canvas area changes size or the tool changes.
- **A fresh view's centre** differs between the two engines and is not part of this item; the parity test compares the view once a zoom command has placed it.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/view_state.rs::fit_selection` | `viewport.ts::fitSelection` |
| `view_state.rs` `bottom_inset`; `crates/engine/src/cmd/view.rs` `view.set bottomInset`, `view.get` | `viewport.ts` `Viewport.bottomInset`, `view.set`, `readView` |
| `crates/ui-egui/src/app.rs` toolbar strip | `editor.ts::setBottomInset`, `Editor.tsx` |

[Property matrix](26-11-21-zoom-selection-parity.html) · [Plan](../planning/26-11-21-zoom-selection.md) · [Zoom parity](../../tests/parity/zoom-selection.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `bac8b73`, native reference `bad07e44` |
| Failing fixtures first | All eleven sequences failed before the change |
| Older expectations | One, described above, changed on a native observation |
| Full pure suite | 5,383 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 401 cumulative Chromium cases passed in one 16.2-minute run with zero skips, retries, flakes or suite errors: the 400 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.63 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,724 nodes/37,320 edges at `bac8b73`; native 28,939/92,127 at `bad07e44`; combined 37,663/128,275. `fitSelection`, `fit_selection`, `setBottomInset`, `readView` and `fitView` verified. |

## Reproduction

```sh
npx vitest run tests/parity/zoom-selection.test.ts tests/parity/viewport.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- A point selection and a rectangle with a coordinate that is not a number are ported from the source: a command cannot make either.
- The browser case measures a tall selection on the desktop layout. The narrow layout, where the toolbar is not over the canvas, was not measured.
- Row 2 continues with item 15, the Invert zoom direction preference.
