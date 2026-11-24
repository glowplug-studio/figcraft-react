# Delta row 4, item 4: the auto layout drag reorder

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `ab5c190`: [report](../reports/26-11-24-auto-layout-drag-reorder.md), [matrix](../reports/26-11-24-auto-layout-drag-reorder-parity.html), [provenance](../../tests/fixtures/native-auto-layout-drag-reorder.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `b66c6f8` on `prompt/full-figcraft-port`.
- Upstream commits: `cf567c3f`, `e415a3a0` (#2142). Ledger item 4.2.
- Files changed: `src/engine/layout-navigation.ts` (`prepareAutoLayoutSlot` takes the dragged box), `src/engine/layout-drop.ts` (`placeMove`), `src/engine/editor.ts` (`previewMove` takes the unsnapped drag), `src/engine/move-interaction.ts`; tests `tests/parity/auto-layout-drag-reorder.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; provenance `tests/fixtures/native-auto-layout-drag-reorder.provenance.md`.
- Next action: none; the item is recorded. Row 4 is closed.
- Blockers: none.

## Native contract

- **`engine/src/canvas/drop.rs::auto_layout_slot_within`** (measured in Figma): layers dragged within their own frame take the slot that the leading edge of the box they would fill decides, their start bounds (combined for several) moved by the unsnapped drag. Moving forward along the flow, they pass every sibling whose middle the high edge has passed; moving backward, or not along the flow, every sibling whose middle lies before the low edge. Wrapping layouts and grids keep their rules, and so does a drag in from another frame.
- **`canvas/tools/drag.rs`**: the drag passed is the pointer's own (`raw`), after the Shift constraint and before snapping.

## What the port had

The slot followed the pointer: a child passed a sibling only when the pointer passed the sibling's middle, so where it was grabbed decided the slot.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/canvas/drop.rs::{auto_layout_slot_within, slot_in}` | `layout-navigation.ts::prepareAutoLayoutSlot` (the `dragged` edges) | Five restated native tests |
| `engine/src/canvas/tools/drag.rs` (`within`, `raw`) | `layout-drop.ts::placeMove`, `editor.ts::previewMove`, `move-interaction.ts` | The same; browser |

## Acceptance

- The restated native cases pass; four of the five failed before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
