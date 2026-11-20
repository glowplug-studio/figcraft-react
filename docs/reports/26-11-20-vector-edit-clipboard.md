# Upstream delta row 2, item 6: copy, cut and paste in vector edit mode

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `6aebd59`. **This bounded item passes. Thirteen items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #1875 (`0fec344f`, `87ce9612`, `ad701088`) made the clipboard act on the selected points and segments while a vector is being edited. The port copied and cut the whole layer and pasted new layers.

- **Copy.** With points or segments selected, [`edit.copy`](../../src/engine/vector-clipboard.ts) takes the selected segments and the segments touching a selected point. Each edited layer gives one temporary vector on the layer clipboard, named Vector, at its place on the page with the layer's look. A variable width profile stays only when every segment is copied. With nothing selected, or with `ids` or `id` given, the whole layer is copied as before.
- **Cut.** `edit.cut` copies the same, removes it as Delete does in one undo step and stays in edit mode. A selected region loses exactly its own segments, so a tail from one of its corners stays.
- **Lone points.** With only points that touch no segment selected, Copy and Cut are refused and change nothing, the clipboard included.
- **Paste while editing.** `edit.paste` adds the clipboard's layers to the edited vector's network in place and selects the pasted points: a vector with its segments, a rectangle, ellipse, polygon, star or boolean group with its outline, a line with no region. Frames, groups and text are skipped and named; when nothing has an outline the paste is refused. `x` and `y` move the copied top-left there, and one alone is refused. `parent` asks for a layer paste.
- **Keys and the system clipboard.** In the [editor](../../src/Editor.tsx) Ctrl/Cmd+X while editing does nothing unless a point or segment is selected. The system clipboard gets the SVG of the partial copy; a refused copy writes nothing.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-vector-clipboard.json](../../tests/fixtures/native-vector-clipboard.json) | Twenty-eight recorded sessions, 354 steps, with every receipt, the network and selection after each stage, layer lists, undo depths and exported SVG | All 28 match. On the first recording of 27 sessions, 23 failed before the change; the four that passed take the whole layer or meet an empty clipboard |

[Provenance and reproduction](../../tests/fixtures/native-vector-clipboard.provenance.md).

## Recorded differences

- **A boolean group's outline starts one point on.** The port's boolean result begins its loop at the next corner from native's. This was recorded with the boolean slices and is queued for the final audit. The boolean session compares the pasted outline as the same closed run of points, whichever point it starts at; every other session compares the network exactly.
- **Layer ids in the edit state** are strings in the port and numbers in native (recorded earlier).
- **Error texts** follow the port's convention and name the same cause.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/edit/vector_clipboard.rs::{edit_selection,sub_network}` | `vector-clipboard.ts::{vectorEditSelection,subNetwork}` |
| `vector_clipboard.rs::{clip_node,copy_parts,copy_selection}` | `vector-clipboard.ts::{clipNode,copyParts,copyVectorSelection}` |
| `vector_clipboard.rs::cut_selection`, `canvas/vectoredit.rs::delete_selection` | `vector-clipboard.ts::cutVectorSelection`, `vector-edit-commands.ts::deleteVectorPart` |
| `vector_clipboard.rs::{outline_network,placed,paste_into_vector}` | `vector-clipboard.ts::{outlineNetwork,placed,pasteIntoVector}` |
| `cmd/edit/clipboard.rs::{names_layers,copy,cut,paste}` | `editor.ts` `edit.copy`, `edit.cut`, `edit.paste` |
| `vector_clipboard.rs::clipboard_svg`; `crates/ui-egui/src/shortcuts.rs` copy mirror and `cut` | `editor.ts::prepareLayerClipboardMirror` (unchanged), `Editor.tsx::copyLayers` |

The port's clipboard holds root ids in a source document where native holds the copied nodes, so a partial copy builds a source document with the temporary layers on the edited layer's page. That document is never the live document, and Copy leaves the document and its history untouched.

[Property matrix](26-11-20-vector-edit-clipboard-parity.html) · [Plan](../planning/26-11-20-vector-edit-clipboard.md) · [Clipboard parity](../../tests/parity/vector-clipboard.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `6aebd59`, native reference `bad07e44` |
| Failing fixtures first | 23 of the first 27 recorded sessions failed before the change |
| Full pure suite | 5,239 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 393 cumulative Chromium cases passed in one 16.7-minute run with zero skips, retries, flakes or suite errors: the 392 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 14.99 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,674 nodes/37,140 edges at `6aebd59`; native 28,939/92,127 at `bad07e44`; combined 37,613/128,097. `vectorEditSelection`, `edit_selection`, `pasteIntoVector`, `paste_into_vector`, `cutVectorSelection`, `cut_selection`, `outlineNetwork`, `outline_network` and `deleteVectorPart` verified. |

## Verification corrections retained

- The first recording used one session for an ellipse, a line and a boolean group together. The port differed only in the boolean outline's starting point, the difference already recorded. The session was split in two and observed again, so the ellipse and the line compare exactly.
- A session built a closed shape with `vector.edit.connect`, which makes no region, so selecting region 0 selected nothing and Cut took the whole layer. What it showed, Cut with nothing selected taking the whole layer, is observed in a session of its own, and the region with a tail is built with the pen commands.
- A step that pasted outside edit mode with a frame's child selected landed at the centre of the view. It tested paste placement, not this item, and was removed before the fixture was recorded.

## Reproduction

```sh
npx vitest run tests/parity/vector-clipboard.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The 500,000-segment limit, and a region's paint frame through a paste, are ported from the source and not observed.
- Native's junk-parameter sweep over the three commands is not restated as a sweep; refused ids, a lone coordinate and an unreadable coordinate are observed.
- The browser case covers one corner of a rectangle. Regions, several edited layers and outlines of other shapes are covered by the native sessions.
- Row 2 continues with item 7, marquee selection.
