# Native observations for copy, cut and paste in vector edit mode (upstream 0fec344f, 87ce9612, ad701088; #1875)

Data: [native-vector-clipboard.json](native-vector-clipboard.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by the disposable `session` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Twenty-eight recorded sessions, 354 steps in all, 11 of them refused. Each session is a list of steps with what every step gave. A step is a command through `Session::execute`, `@selection` (the selected layer ids) or `@undoDepth` (the undo and redo depths). A refused command is stored as `{"error": message}`.

The sessions edit an open path of four points (100,100), (200,150), (300,100), (400,200), or a shape, with `vector.edit.begin`, select with `vector.edit.select`, and read the result with `vector.edit.state` (the network, the selection and the page-space overlay), `node.get` and, where the look matters, `file.exportSvg`. A lone point and a tail on a closed shape are made with the pen commands (`vector.edit.tool`, `vector.edit.pen`, `vector.edit.penEnd`).

| Session | Steps | Refused |
|---|---|---|
| a copied segment pastes outside as a new vector in place | 19 | 0 |
| a copied point takes the segments touching it | 12 | 0 |
| nothing selected still copies the whole layer | 11 | 0 |
| with ids given Copy takes the layer even with a segment selected | 13 | 0 |
| cut removes the segment in the same layer and stays in edit mode | 16 | 0 |
| cut is one undo step | 9 | 0 |
| a cut point takes its segments with it | 13 | 0 |
| with nothing selected Cut takes the layer and leaves edit mode | 8 | 1 |
| pasting segments while editing adds them to the same network in place | 14 | 0 |
| pasting at a point moves the copied top-left there | 8 | 0 |
| a cut segment pastes back while editing | 12 | 0 |
| pasting a rectangle while editing adds its outline in the vector's coordinates | 13 | 0 |
| an ellipse and a line join as outlines, the line with no region | 9 | 0 |
| a boolean group joins as its outline | 10 | 0 |
| a rotated vector takes pasted points in its own coordinates | 11 | 0 |
| a vector in a frame | 10 | 0 |
| layers with no outline are skipped and named | 17 | 1 |
| a parent still pastes layers while editing | 8 | 0 |
| an empty clipboard refuses to paste while editing | 5 | 1 |
| a selected face copies its own outline with the fill | 12 | 0 |
| a selected region copies its segments | 12 | 0 |
| only one of x and y is refused and pastes nothing | 10 | 2 |
| cut and copy with only a lone point are refused and change nothing | 26 | 2 |
| cutting a selected region deletes exactly the segments it copies and keeps a tail | 20 | 0 |
| several edited layers each give a piece | 16 | 0 |
| a partial copy drops a variable width profile and a whole copy keeps it | 15 | 0 |
| a partial copy pastes outside at a point | 11 | 0 |
| ids that are not layers are refused in edit mode | 14 | 4 |

Seventeen restate tests of `crates/engine/src/cmd/edit/vector_clipboard_tests.rs` at the command level. Its junk-parameter sweep, its huge paste position and its system clipboard SVG test are not restated here. Where a native test edits the network directly (a lone point, a tail) the session builds the same network with the pen commands. Added beside them: `ids` given while a segment is selected, Cut with nothing selected, a cut segment pasted back, an ellipse and a line, a boolean group, a vector in a frame, a selected region, several edited layers, the width profile, a partial copy pasted outside at a point, and ids that are not layers.

## What the observations showed

- Copy with a segment selected gives `{copied: 1, segments: 1}` and changes nothing. Pasted outside edit mode it is a new layer named Vector at the segment's own page position, with the layer's opacity and fills, selected.
- A selected point takes the segments touching it. With nothing selected, or with `ids` given, the whole layer is copied as before.
- Cut gives `{cut, segments}`, removes the selection in the same layer in one undo step and stays in edit mode with nothing selected. With nothing selected it cuts the layer and leaves edit mode.
- Paste while editing gives `{ids: [], edited, vertices}`, adds the copied segments at their page position in the vector's own coordinates (also when the vector is rotated or in a frame), selects the pasted points and takes one undo step. With `x` and `y` the copied top-left lands there; one of the two alone is refused. With `parent` given it pastes a layer.
- A rectangle, an ellipse and a boolean group join as their outline with its region; a line joins with no region. Frames, groups and text have no outline: they are named in `skipped`, and when nothing has one the paste is refused and changes nothing.
- With only a lone point selected Copy and Cut are refused and change nothing, the clipboard included; Delete removes the point.
- Cutting a selected region removes exactly the region's segments. A tail from one of its corners stays, and the copy holds the region with its fill.
- With several layers edited, each gives a piece; the pieces paste as layers in the order active layer first.
- A partial copy has no variable width profile: its exported stroke is a plain 8-unit line. A copy of every segment keeps the profile and exports as the source does.
- `ids` that are not layers are refused as on any command.

## Reproduction outside the port runtime

Run the `session` executable of the [locked layers provenance](native-locked-layers.provenance.md) (source SHA-256 `5132a01344693e83267eab19643ee50f6f1944e43e10c5fb186c61ba8b899fc8`) with `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.
