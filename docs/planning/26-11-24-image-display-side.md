# Delta row 3, item 16: zoomed-out image copies

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `dbef659`: [report](../reports/26-11-24-image-display-side.md), [matrix](../reports/26-11-24-image-display-side-parity.html), [provenance](../../tests/fixtures/native-image-display-side.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `81b6b63` on `prompt/full-figcraft-port`.
- Upstream commits: `c82986b2`, `503823f9` (docs). Ledger item 3.7.
- Files changed: `src/engine/image-renderer.ts` (`displaySides`, `displaySide`, the canvas-only display mode), `src/engine/canvas.ts` (exports draw from the image itself); tests `tests/parity/image-display-side.test.ts` (new), the large-image expectation in `tests/e2e/image-rendering.spec.ts`; provenance `tests/fixtures/native-image-display-side.provenance.md`.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Blockers: none.

## Native contract

- **`render/src/images.rs::{DISPLAY_SIDES, display_side, shown}`**: the canvas draws an image from the smallest of 256, 512, 1024, 2048, 4096 and 8192 px copies that holds the size it shows in device pixels and is smaller than the image, else from the image itself (`MAX_SIDE`).
- **`get`**: exports and every other render draw from the image itself.

## What the port had

The canvas chose only 4096 or 8192 px copies, and exports went through the same choice, so an export of an image over 4096 px drawn smaller came from a 4096 px copy.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `render/src/images.rs::{DISPLAY_SIDES, display_side}` | `image-renderer.ts::{displaySides, displaySide}` | Unit |
| `render/src/images.rs::shown` (canvas) and `get` (exports) | `CanvasImages` display mode: the canvas's `#draw`; `canvas.ts::paintExportSteps` without it | Browser large-image case; raster export suite |

## Acceptance

- The restated native case fails on the old code (4096 × 5) and passes after (2048 × 3).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
