# Upstream delta row 3, item 16: zoomed-out image copies

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `dbef659`. **This bounded item passes. Two items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **Smaller copies.** The canvas draws an image shown smaller than its pixels from the smallest of 256, 512, 1024, 2048, 4096 and 8192 px copies that holds the size shown and is smaller than the image, else from the image itself ([`displaySide`](../../src/engine/image-renderer.ts)). A zoomed-out page of photos now decodes small copies that stay within the cache's budget.
- **Exports from the image itself.** As native's `get`, exports no longer go through the canvas's copy choice ([`canvas.ts`](../../src/engine/canvas.ts) `paintExportSteps`). Before, an export of an image over 4096 px drawn smaller came from a 4096 px copy.

## Native reference

| Case | Result |
|---|---|
| Unit: native `side` assertions | 2048, 256, 256 and the image itself, as native ([provenance](../../tests/fixtures/native-image-display-side.provenance.md)) |
| Browser: two 6000 × 8 images at 25% | Drawn from 2048 × 3 copies, as native's restated test now says. The old code gives 4096 × 5 and fails |
| Browser: image rendering and raster export suites | All 28 pass unchanged |

## Recorded differences

- **Tiles.** The port keeps drawing tiled image fills from the image itself, as before.
- **Timing.** Native's measured speed-ups belong to its renderer; the port's cache budget and copies follow the same sizes.

## Native mapping

| Native | React |
|---|---|
| `crates/render/src/images.rs::{DISPLAY_SIDES, display_side, shown}` | `image-renderer.ts::{displaySides, displaySide}`, `CanvasImages` display mode |
| `crates/render/src/images.rs::get` | `canvas.ts::paintExportSteps` (`new CanvasImages(undefined, false)`) |

[Property matrix](26-11-24-image-display-side-parity.html) · [Plan](../planning/26-11-24-image-display-side.md) · [Unit](../../tests/parity/image-display-side.test.ts) · [Browser](../../tests/e2e/image-rendering.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `dbef659`, native reference `bad07e44` |
| Failing fixtures first | The restated large-image case failed on the old code (4096 × 5) |
| Full pure suite | 5,537 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 419 cumulative Chromium cases passed in one 16.5-minute run at `dbef659` with zero skips, retries, flakes or suite errors, the same 419 cases as before with the large-image expectation updated to native's 2048 × 3 copies. No baseline changed |
| Real local provider integrations | 32 passed in 13.68 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,898 nodes/38,003 edges at `dbef659`; native 28,939/92,127 at `bad07e44`; combined 37,837/128,941. `displaySide`, `displaySides`, `CanvasImages`, `display_side` and `DISPLAY_SIDES` verified. |

## Reproduction

```sh
npx vitest run tests/parity/image-display-side.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/image-rendering.spec.ts tests/e2e/raster-export.spec.ts --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 3 continues with item 17, the eyedropper over a magnified image.
