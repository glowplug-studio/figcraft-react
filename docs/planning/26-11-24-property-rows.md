# Delta row 3, item 15: paint row copy and paste

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `c0c2a9d`: [report](../reports/26-11-24-property-rows.md), [matrix](../reports/26-11-24-property-rows-parity.html), [provenance](../../tests/fixtures/native-property-rows.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `29b767a` on `prompt/full-figcraft-port`.
- Upstream commits: `375a7b8a`, `33ac1d14`, `b640fbc1` (docs), `0ad70b95` (#1494). Ledger item 3.18.
- Files changed: `src/engine/property-rows.ts` (new), `src/engine/editor.ts` (highlight, property copy and paste, follow), `src/PropertyRow.tsx` (new), `src/AppearancePanel.tsx`, `src/StrokePanel.tsx`, `src/EffectsPanel.tsx`, `src/Editor.tsx`; tests `tests/parity/property-rows.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; provenance `tests/fixtures/native-property-rows.provenance.md`.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Gate note: about 55 cases into this gate, item 16's first source edit (`image-renderer.ts`, `canvas.ts`) was made by mistake and reverted within minutes; the fixture suites that bundle `src` had already run, and the edit touched no code this item or the earlier cases load, so the 419 result stands for this item's commit.
- Blockers: none.

## Native contract

- **Highlight** (`property_rows.rs::{click, row, current, reconcile, escape, follow}`): a click on a fill, stroke or effect row's background or grip highlights it for the selection; it goes with another selection, Escape, a press on the canvas or elsewhere in the Design panel, or when its row is gone; it follows its paint when rows move or one is removed.
- **Copy** (`copy_highlighted`, `copy`): Cmd/Ctrl+C with a highlighted row runs `fill.copy`, `stroke.copy` or `effect.copy` instead of copying the layers; the system clipboard gets a solid's hex code (`Color::to_css_hex`) or the kind's marker. A programmatic copy writes nothing there.
- **Paste** (`paste`): while that copy is the last thing copied (no layer copy since, its kind still on the engine clipboard, and for a user's paste the system clipboard still its mirror), Cmd/Ctrl+V pastes it onto every selected layer, in place of the highlighted row of that kind else on top, one undo step. A copy whose engine copy is gone pastes nothing rather than older layers.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `ui-egui/src/property_rows.rs::{Highlight, current, click, escape, follow}` | `editor.ts::{propertyRow, highlightPropertyRow, clearPropertyRow}`, the `execute` follow, `property-rows.ts::followIndex` | Unit 6, 7; browser |
| `property_rows.rs::reconcile` | `PropertyRow.tsx::releasePropertyRow` on the Design panel and canvas; the `#publish` checks | Browser; unit 6 |
| `property_rows.rs::{copy_highlighted, copy}` | `editor.ts::{copyPropertyRow, copyProperty}`, `Editor.tsx::copyLayers` | Units 1, 4, 10; browser |
| `property_rows.rs::paste` | `editor.ts::pasteProperty`, `Editor.tsx::paste` | Units 1–3, 5, 8–10; browser |
| Row targets in `panels/right/{paints, effects}.rs` | `PropertyRow.tsx::propertyRowProps` in the fill, stroke and effect rows | Browser |

## Acceptance

- The restated cases pass; the browser case needs the row targets, which the port lacked.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
