# Delta row 2, item 11: the Scale tool

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `9ee41a2`: [report](../reports/26-11-21-scale-tool.md), [matrix](../reports/26-11-21-scale-tool-parity.html), [provenance](../../tests/fixtures/native-scale-tool.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `46df774` on `prompt/full-figcraft-port`.
- Upstream commits, in date order: `92145e6f`, `68564374`, `197a390a`, `7a8d422d` (9 November, #2146 and #2148), `f0d39197` (12 November). Ledger item 2.16.
- Files landed: `src/engine/transform-handles.ts`, `transform-preview.ts`, `transform-interaction.ts`, `editor.ts`, `src/ScalePanel.tsx`, `src/Editor.tsx`; tests `tests/parity/scale-tool.test.ts` (new), `transform-handles.test.ts`, `pen-interaction.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-scale-tool.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Measured by upstream in the target application on 9 November 2026.

- **Handle drags.** With the Scale tool, a drag of a transform handle scales everything by one factor about the opposite handle's point, or about the centre with Alt. The origin grid does not decide the pivot (`canvas/tools/handles.rs::scale_factor`).
- **The origin.** The origin (`tool.scaleAnchor`) is used by the Scale field only and starts at the centre (`session/new.rs`).
- **The field.** K opens the tool with the factor field focused and its text selected, so K, 2, Enter scales by two. The field takes the keyboard when the section appears: the tool was chosen with a selection, or the panel came back. A selection that appears after K with nothing selected does not give it the keyboard. Plain Enter or Escape in the field ends the tool, back to Move with the selection kept; Enter applies the factor first, Escape changes nothing. Ctrl+Enter and Alt+Enter are not the tool's exit. Enter in the width or height field keeps the tool (`ui-egui/src/panels/scale_panel.rs`).

## What the port had

A handle drag pivoted on the origin grid's point unless that point lay on the dragged side. The origin started at the top left. The factor field was not focused when the tool opened, and nothing in it ended the tool.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `tools/handles.rs::scale_factor` | `transform-handles.ts::scaleFactor`, without the anchor | Nine native sessions in `native-scale-tool.json`; the native unit test restated in `transform-handles.test.ts` |
| `tools/drag.rs` resize with the Scale tool | `transform-preview.ts::previewResize`, `transform-interaction.ts` | The same sessions |
| `session/new.rs` `scale_anchor: (1, 1)` | `editor.ts` initial `scaleAnchor: "c"` | The origin session |
| `ui-egui/src/panels/scale_panel.rs::section` focus and endings | `ScalePanel.tsx` factor field, `Editor.tsx` returning focus to the canvas | Signed-in browser workflow restating `field_tests.rs` |

## Hazards and known differences

- Two older port tests pinned the anchor as a drag's pivot and the top-left default. They change on the native observations.
- Native's factor field also reads `2x`. The port's field is a number input and takes `2`; text forms belong with the Design panel fields of the interface row.
- The port's Apply scale factor button has no native counterpart; it applies and keeps the tool.
- In the port the section is a React component mounted while the tool is active, so "the panel came back" is a remount. The port has no second tab that hides the Design panel while the tool is on.

## Acceptance

- All nine native sessions match.
- The signed-in browser workflow shows K, 2, Enter; Escape; Ctrl+Enter; and a selection appearing after K.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
