# Delta row 3, item 14: page background

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `d578735`: [report](../reports/26-11-24-page-background.md), [matrix](../reports/26-11-24-page-background-parity.html), [provenance](../../tests/fixtures/native-page-background.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `68e4ed3` on `prompt/full-figcraft-port`.
- Upstream commits: `481b6831`, `a45d932a`, `d9f52aab` (roadmap only), `67c232ea`. Ledger item 3.14.
- Files changed: `src/engine/page-background-field.ts` (new), `src/Editor.tsx` (the canvas's backdrop), `src/AppearancePanel.tsx`; tests `tests/parity/page-background-field.test.ts` (new), one new case in `tests/e2e/preview.spec.ts` with the page label renamed in three others; provenance `tests/fixtures/native-page-background.provenance.md`.
- A first attempt drew the grid in `canvas.ts::paintPage`; the render-parity suites, which expect a see-through page as native's renderer gives, failed, so the gate was stopped and the grid moved behind the canvas element, as native draws it behind the rendered texture.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Blockers: none.

## Native contract

- **`canvas/background.rs::paint`**: below full opacity, the page draws over a checkerboard of 8-point squares in the theme's panel and canvas colours (light #FFFFFF and #F5F5F5), anchored at the canvas's top left; the rendered pixels carry the page colour once.
- **`panels/right.rs::page_section`**: the page row is the shared paint field: six HEX digits and a fractional opacity percentage (50.2% for #FF000080). A typed colour keeps the page's opacity unless it carries 4 or 8 hex digits.

## What the port had

The canvas cleared and filled the page colour, so a translucent page showed whatever was behind the canvas element (the editor's plain background). The page row was a CSS colour text field: a typed colour replaced the opacity.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `ui-egui/src/canvas/background.rs::{paint, grid_texture}` | `page-background-field.ts::{transparencyGrid, canvasBackdrop}`, the Design canvas's background in `Editor.tsx` | Unit; browser screen and canvas pixels |
| `ui-egui/src/panels/right.rs::page_section` | `page-background-field.ts::{pageHex, pageOpacity, typedPageColour}`, `AppearancePanel.tsx` page form | Unit and browser |

## Acceptance

- The browser case fails before the change and passes after; the unit cases restate the native field tests.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
