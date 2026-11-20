# Delta row 2, item 4: the Rotation field's rotation on the page

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `3a1c529`: [report](../reports/26-11-20-page-rotation.md), [matrix](../reports/26-11-20-page-rotation-parity.html), [provenance](../../tests/fixtures/native-absolute-rotation.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `814c157` on `prompt/full-figcraft-port`.
- Upstream commits: `d0379dc7`, `cc367717`, `7e748d4a`; documentation `accdfbae` (#2196, #2200). Ledger item 2.15.
- Files landed: `src/engine/properties.ts`, `geometry-fields.ts`, `editor.ts`, `layer-flags.ts` (a comment), `src/GeometryPanel.tsx`; tests `tests/parity/absolute-rotation.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-absolute-rotation.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- `node.set` takes a new additive key, `absoluteRotation`: the layer's rotation on the page, its own angle plus its parents'. The layer is turned about its centre in page space and the result is taken back into its parent's space. If the parent's transform cannot be inverted the local angle is set instead. `rotation` stays the angle to the parent, for scripts, inspection, code and the file formats. Giving both in one call is refused.
- With several layers, a selected parent is turned before the layers in it, so a frame and a layer inside it both land on the typed page angle whatever the order of the ids.
- A moved rotation origin applies to `absoluteRotation` as it does to `rotation`.
- The Design panel's Rotation field shows the page rotation, to two decimals, Mixed when the selected layers' page angles differ, and writes `absoluteRotation` in one call for every selected layer. A relative edit of a Mixed field applies to each layer's page angle, parents first.

## What the port had

`node.set` knew `rotation` only. The Geometry panel showed each layer's own angle and wrote `rotation`; a mixed relative edit applied to each layer's own angle in selection order.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/props.rs` `absoluteRotation` | `properties.ts` `node.set`, beside `rotation` | Ten native sequences in `native-absolute-rotation.json` |
| `cmd/edit/props.rs` parents-first order and the moved-origin pivot | `properties.ts` ordering and pivot condition | The same fixture |
| `ui-egui/panels/right.rs::{rot_of,rotation_row}` | `geometry-fields.ts::shownGeometry`, `GeometryPanel.tsx` | Field tests restated; signed-in browser workflow |
| `ui-egui/panels/right.rs` relative edit, parents first (`7e748d4a`) | `editor.ts::editMixedGeometry` | Field test restated |

## Hazards and known differences

- Scrubbing and arrow-key stepping of the native Rotation field have no counterpart in the port's inputs (roadmap row 19).
- For a top-level layer the page angle is its own angle, so existing workflows on top-level layers are unchanged.
- A comment in `layer-flags.ts` described Show/Hide the wrong way round; the code was right. It is corrected with this item.

## Acceptance

- All ten native sequences match receipt for receipt; all were refused before the change.
- The restated field tests pass.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
