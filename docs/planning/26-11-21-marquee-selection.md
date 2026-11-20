# Delta row 2, item 7: marquee selection

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `f66ead9`: [report](../reports/26-11-21-marquee-selection.md), [matrix](../reports/26-11-21-marquee-selection-parity.html), [provenance](../../tests/fixtures/native-marquee.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `f6026f4` on `prompt/full-figcraft-port`.
- Upstream commits: `cb526214`, `604c7846`. Ledger item 2.3.
- Files landed: `src/engine/marquee.ts` (new), `canvas-selection.ts`; tests `tests/parity/marquee.test.ts` (new), `move-interaction.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-marquee.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

`crates/doc/src/geometry.rs::marquee_select`, measured by upstream in the target application on 11 November 2026.

- Each top-level layer the marquee touches is selected whole, except a frame with children or a section with its contents shown. Covered by the marquee, such a frame is selected itself. Partly covered, it gives the layers in it that the marquee touches.
- The frame the drag started in is selected only when the marquee also takes another top-level frame whole; then it comes whole. Otherwise only the layers in it that the marquee touches are selected.
- Selecting any frame or section whole keeps the marquee at the top level: no frame opens, and a partly covered one comes whole.
- An empty frame is selected on touch. Components, instances and sections with hidden contents are selected only when covered.
- A layer is touched when its page box overlaps the marquee, edges included. A rotated rectangle, ellipse, polygon, star, line or vector must also be touched on its outline: a path end inside the marquee, a path segment crossing a marquee edge, or the marquee inside the filled shape.
- Covered means both corners of the layer's page box are inside the marquee, whose far edges are outside.
- Ctrl or Cmd selects the innermost layers touched; Shift toggles. Hidden and locked layers are never selected.

## What the port had

`canvas-selection.ts::marqueeSelection` selected the children of the top-level frame the drag started in and nothing outside it, skipped a partly covered frame, and touched every layer by its page box, rotated or not.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `geometry.rs::marquee_select` | `marquee.ts::marqueeSelect` | 21 native sessions in `native-marquee.json` |
| `geometry.rs::{marquee_children,marquee_touches,path_touches_rect}` | `marquee.ts::{marqueeChildren,marqueeTouches,pathTouchesBox}`; curve and line crossings through `fit-polynomial.ts::fitCubicRoots`, the port of the solver Kurbo's `intersect_line` uses | The rotated sessions |
| `geometry.rs::marquee_deep` | `marquee.ts::marqueeDeep` | The Ctrl/Cmd session |
| `canvas/tools/pointer.rs::{marquee_within,marquee_selection}` | `canvas-selection.ts::{marqueeWithin,marqueeSelection}` | The drags begun inside a frame; the Shift session |

## Hazards and known differences

- One older port test pinned the earlier rule (a partly covered frame skipped). Its scene is observed natively as the last session and the test changed on that.
- `select.area`, the command that selects what a marquee over a box would, is not in the port. It predates this change (command inventory: Not tested) and belongs with the keyboard box selection of the interface row. It is added to the final-audit queue.
- The port has no focus view and no board items or widgets, so those branches of the native functions have no counterpart here.

## Acceptance

- All 21 native sessions match, selection for selection and in order.
- A signed-in browser workflow covers a partly covered frame, a covered frame and a drag from inside a frame.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
