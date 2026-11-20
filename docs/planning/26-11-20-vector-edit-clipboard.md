# Delta row 2, item 6: copy, cut and paste in vector edit mode

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `6aebd59`: [report](../reports/26-11-20-vector-edit-clipboard.md), [matrix](../reports/26-11-20-vector-edit-clipboard-parity.html), [provenance](../../tests/fixtures/native-vector-clipboard.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `46e3eb6` on `prompt/full-figcraft-port`.
- Upstream commits: `0fec344f` (#1875), `87ce9612`, `ad701088` (#2105 review). Ledger item 2.1.
- Files landed: `src/engine/vector-clipboard.ts` (new), `vector-edit-commands.ts`, `editor.ts`, `src/Editor.tsx`; tests `tests/parity/vector-clipboard.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-vector-clipboard.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Measured by upstream in the target application and implemented in `crates/engine/src/cmd/edit/vector_clipboard.rs`.

- **Copy.** In vector edit mode with points or segments selected, and no layer named by `ids` or `id`, Copy takes the selected segments and the segments touching a selected point. Points selected only through a selected region do not pull in the segments touching them: the region's own segments are the selection. Each edited layer with something to copy gives one temporary vector on the layer clipboard, named Vector, at its place on the page, with the layer's look. A variable width profile stays only when every segment is copied. The result is `{copied, segments}`. With only lone points selected Copy is refused. With nothing selected the whole layer is copied as before.
- **Cut.** Copy, then remove the same points and segments as Delete does, in one undo step, staying in edit mode with nothing selected. Refused exactly where Copy is, changing nothing. The result is `{cut, segments}`.
- **Paste while editing.** Without `parent`, the clipboard's layers join the edited vector's network in place: a vector with its segments, a rectangle, ellipse, polygon, star or boolean group with its outline, a line with its segment and no region. Other layers are skipped and named in `skipped`; when none has an outline the paste is refused. With `x` and `y` the copied top-left moves there; one alone is refused. An empty clipboard and more than 500,000 segments are refused. The pasted points are selected. The result is `{ids: [], edited, vertices}`.
- **Keys.** Ctrl/Cmd+X in vector edit mode runs Cut only with a point or segment selected. The system clipboard gets the SVG of the partial copy, and nothing when the copy was refused.

## What the port had

Copy and Cut always took the whole layer, so Cut in edit mode removed the layer and left edit mode. Paste while editing made new layers.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `vector_clipboard.rs::{edit_selection,sub_network}` | `vector-clipboard.ts::{vectorEditSelection,subNetwork}` | Native sessions in `native-vector-clipboard.json` |
| `vector_clipboard.rs::{clip_node,copy_parts,copy_selection}` | `vector-clipboard.ts::{clipNode,copyParts,copyVectorSelection}`; the temporary layers live in the clipboard's own source document | The same sessions |
| `vector_clipboard.rs::cut_selection`, `vectoredit::delete_selection` | `vector-clipboard.ts::cutVectorSelection`, `vector-edit-commands.ts::deleteVectorPart` | The same sessions |
| `vector_clipboard.rs::{outline_network,placed,paste_into_vector}` | `vector-clipboard.ts::{outlineNetwork,placed,pasteIntoVector}` | The same sessions |
| `cmd/edit/clipboard.rs::{names_layers,copy,cut,paste}` | `editor.ts` `edit.copy`, `edit.cut`, `edit.paste` | The same sessions |
| `vector_clipboard.rs::clipboard_svg`, `ui-egui/src/shortcuts.rs` copy mirror and `cut` | `editor.ts::prepareLayerClipboardMirror` (unchanged: it exports the clipboard's own layers), `Editor.tsx::copyLayers` | Signed-in browser workflow |

## Hazards and known differences

- The port's clipboard holds root ids in a source document, where native holds the copied nodes. A partial copy therefore builds a source document with the temporary layers on the edited layer's page. That document never becomes the live document.
- The port's boolean result starts its loop one point on from native's (recorded earlier, queued for the final audit). The boolean session compares the pasted outline as the same closed run of points.
- The edit state names layers by string id in the port and by number in native (recorded earlier).
- The 500,000-segment limit and regions' paint frames through a paste are ported from the source and not observed.
- Error texts follow the port's convention.

## Acceptance

- All 28 native sessions match: receipts, networks, selections, layer lists, undo steps and exported SVG.
- A signed-in browser workflow covers Copy, Paste while editing, Cut and the paste outside edit mode, with the system clipboard's SVG.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
