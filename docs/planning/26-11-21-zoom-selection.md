# Delta row 2, item 14: Zoom to selection

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `bac8b73`: [report](../reports/26-11-21-zoom-selection.md), [matrix](../reports/26-11-21-zoom-selection-parity.html), [provenance](../../tests/fixtures/native-zoom-selection.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `251b3fa` on `prompt/full-figcraft-port`.
- Upstream commits: `fceb6063`, `5d529269`, `53bf0a40` (#2139 review). Ledger item 2.10.
- Files landed: `src/engine/viewport.ts`, `editor.ts`, `src/Editor.tsx`; tests `tests/parity/zoom-selection.test.ts` (new), `viewport.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-zoom-selection.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Measured by upstream in the target application on 9 November 2026. `crates/engine/src/view_state.rs::fit_selection`:

- Zoom to selection fits the selection into the canvas above the floating bottom toolbar, with a 40 point margin on all four sides, centred in that area.
- The view has an unsaved `bottom_inset`, the height of the strip the toolbar covers, 0 when hidden. The UI sets it every frame; `view.set bottomInset` sets it too, held between 0 and 20,000. `view.get` does not give it back. For the fit it is held to one point less than the canvas height.
- When 40 points do not fit, the margin is a quarter of the area's width or height.
- A point selection is centred in the area at the zoom the view has. A rectangle that is not all finite numbers leaves the view alone.
- Zoom to fit keeps its 64 point margin and the whole canvas.

## What the port had

`view.zoomSelection` used the same fit as Zoom to fit: a 64 point margin in the whole canvas. The view had no inset.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `view_state.rs::fit_selection` | `viewport.ts::fitSelection` | Eleven native sequences in `native-zoom-selection.json` |
| `view_state.rs` `bottom_inset`, `cmd/view.rs` `view.set bottomInset` and `view.get` | `viewport.ts` `Viewport.bottomInset`, `view.set`, `readView` | The same sequences |
| `ui-egui/src/app.rs` setting the inset from the toolbar pill | `editor.ts::setBottomInset`, `Editor.tsx` measuring the toolbar over the canvas | Signed-in browser workflow |

## Hazards and known differences

- One older port test pinned the 64 point margin for Zoom to selection. It changes on the native observation of the same scene.
- The port measures the toolbar element's top edge against the canvas's bottom edge when the toolbar or the canvas area changes size or the tool changes, where native sets the inset every frame. When the toolbar does not lie over the canvas, as in a narrow layout, the inset is 0.
- A fresh view's centre differs between the two engines; the parity test compares the view once a zoom command has placed it.

## Acceptance

- All eleven native sequences match.
- A signed-in browser workflow measures 40 pixels above and below a tall selection, between the canvas's top edge and the toolbar.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
