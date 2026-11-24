# Delta row 3, item 13: the caret colour

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `0e82958`: [report](../reports/26-11-24-caret-colour.md), [matrix](../reports/26-11-24-caret-colour-parity.html), [provenance](../../tests/fixtures/native-caret-colour.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `830539d` on `prompt/full-figcraft-port`.
- Upstream commits: `2beec8b3` (#2156), `06d03a54` (#2190), `3cdc5f7e`, `6920ea63`, `e3701d85` (#2163 review). Ledger item 3.11.
- Files changed: `src/engine/caret-colour.ts` (new), `src/engine/canvas-text-input.ts`; tests `tests/parity/caret-colour.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; provenance `tests/fixtures/native-caret-colour.provenance.md`.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Blockers: none.

## Native contract

- **`overlays.rs::caret_fill`**: the fill the next typed character gets, read from the character before the caret (the first one's at 0, the base style for an empty text): the run's own fills, else the layer's. The topmost visible paint, if a solid, gives the caret colour at alpha 1; a gradient, image or no visible fill gives none.
- **`overlays.rs::caret_fallback`**: black, or white when the surface is dark (`Color::is_dark`: white contrasts more than black). The surface is the nearest container of the text whose topmost visible fill is a solid with colour alpha × paint opacity × its own and its containers' layer opacity at least 0.5, else the page; containers with a gradient or image on top are passed over.
- Width, height, the selection and collaborators' carets are unchanged.

## What the port had

The caret was drawn in the canvas accent green whatever the text.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `ui-egui/src/canvas/overlays.rs::caret_fill` | `caret-colour.ts::caretFill` | Five restated native tests |
| `ui-egui/src/canvas/overlays.rs::caret_fallback`, `color::Color::is_dark` | `caret-colour.ts::caretFallback` | Two restated native tests |
| `ui-egui/src/canvas/overlays.rs::text_edit_overlay` caret stroke | `canvas-text-input.ts::draw` | Browser caret pixels |

## Acceptance

- Each restated native test passes; the browser case failed on the accent caret and passes after.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
