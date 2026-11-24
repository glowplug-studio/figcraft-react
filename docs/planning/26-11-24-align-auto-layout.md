# Delta row 4, item 3: Align unavailable in an auto layout flow

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `1ab10c7`: [report](../reports/26-11-24-align-auto-layout.md), [matrix](../reports/26-11-24-align-auto-layout-parity.html), [provenance](../../tests/fixtures/native-align-auto-layout.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `30f7743` on `prompt/full-figcraft-port`.
- Upstream commit: `76965c78`. Ledger item 4.3.
- Files changed: `src/engine/arrange.ts` (`inAutoLayoutFlow`, `alignBlockedByAutoLayout`, `canAlign`), `src/ArrangePanel.tsx` (the tip); tests `tests/parity/align-auto-layout.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-align-auto-layout.json` with provenance.
- Next action: none; the item is recorded. Row 4 continues in its row plan.
- Blockers: none.

## Native contract

- **`engine/src/cmd/arrange.rs::{align_target, in_auto_layout_flow, align_blocked_by_auto_layout}`** (measured in Figma): one selected layer that sits in an auto layout frame and takes part in its flow (not absolute) has no align target, so `can_align` is false and the align commands change nothing. An absolute child still aligns to its frame; several layers are unchanged.
- **`ui-egui/src/panels/right.rs`**: the Align buttons are off with the tip "A layer in an auto layout frame is placed by its frame".

## What the port had

`canAlign` was true for any one child of a frame, so the Align buttons were on for a flow child and an align command recorded an undo step whose move the auto layout then undid.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/cmd/arrange.rs::{align_target, in_auto_layout_flow}` | `arrange.ts::{canAlign, inAutoLayoutFlow}` (the align branch of `executeArrange` already returns the document when `canAlign` is false) | Nine native scenes |
| `arrange.rs::align_blocked_by_auto_layout`, `panels/right.rs` tip | `arrange.ts::alignBlockedByAutoLayout`, `ArrangePanel.tsx` | Unit; browser |

## Acceptance

- Each native observation matches, the align commands leaving the document object unchanged; seven of the ten new cases failed before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
