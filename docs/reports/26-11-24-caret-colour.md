# Upstream delta row 3, item 13: the caret colour

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `0e82958`. **This bounded item passes. Five items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **The text's colour.** [`caretFill`](../../src/engine/caret-colour.ts) takes the fill the next typed character gets (the character before the caret, the first one's at 0; the run's fills, else the layer's). Its topmost visible paint, if a solid, is the caret colour, drawn opaque.
- **Otherwise black or white.** [`caretFallback`](../../src/engine/caret-colour.ts) finds the nearest container whose top visible solid is at least half opaque as drawn, else the page, and uses white when that colour is dark and black otherwise.
- [`canvas-text-input.ts`](../../src/engine/canvas-text-input.ts) draws the caret with them instead of the accent green. The selection, the composition underline and the caret's size are unchanged.

## Native reference

The overlay is native interface code, which the replay oracle does not drive; the port restates the seven native caret tests ([provenance](../../tests/fixtures/native-caret-colour.provenance.md)).

| Case | Result |
|---|---|
| Unit: the seven native caret tests | All pass. They could not run before: the functions are new |
| Browser: a red text, a gradient text on the page and one in a #222222 frame, caret after the trailing space | The caret's antialiased pixels are the background blended towards red, black and white. Before, the pixels blended towards the accent green and the case failed |

## Recorded differences

- **Colour management.** The browser canvas reads a red caret back near (241,54,60), not (255,0,0), so the browser case accepts a blend within 16 units per channel; the accent green misses by about 200 units on red.
- **Screen conversion.** Native converts the caret colour with its screen profile conversion (`doc_c32`); the port draws it as the canvas draws solid fills.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/canvas/overlays.rs::caret_fill` | `caret-colour.ts::caretFill` |
| `crates/ui-egui/src/canvas/overlays.rs::caret_fallback`, `crates/color/src/lib.rs::Color::is_dark` | `caret-colour.ts::caretFallback` |
| `crates/ui-egui/src/canvas/overlays.rs::text_edit_overlay` | `canvas-text-input.ts::draw` |

[Property matrix](26-11-24-caret-colour-parity.html) · [Plan](../planning/26-11-24-caret-colour.md) · [Unit](../../tests/parity/caret-colour.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `0e82958`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed on the accent caret; the unit cases test new functions |
| Full pure suite | 5,523 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 417 cumulative Chromium cases passed in one 17.0-minute run at `0e82958` with zero skips, retries, flakes or suite errors: the 416 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.21 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,866 nodes/37,832 edges at `0e82958`; native 28,939/92,127 at `bad07e44`; combined 37,805/128,773. `caretFill`, `caretFallback`, `CanvasTextInput`, `caret_fill` and `caret_fallback` verified. |

## Reproduction

```sh
npx vitest run tests/parity/caret-colour.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "text caret takes" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Native marks the caret's opacity as unmeasured against Figma; the port follows native's opaque caret.
- Row 3 continues with item 14, the page background.
