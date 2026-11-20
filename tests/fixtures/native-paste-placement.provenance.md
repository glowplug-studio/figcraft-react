# Native observations for paste placement and stacking (upstream c74bcd0b, 476daeab)

Data: [native-paste-placement.json](native-paste-placement.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Eleven command sequences through `Session::execute` with every receipt. Each builds a few layers, copies some, sets the selection or the view, pastes, and reads the parent and the copies with `node.get` (`type`, `name`, `x`, `y`, `width`, `height`, `absoluteBounds`, `children`). The parent's `children` list gives the stacking order, bottom first.

| Name | Commands, in order of first use |
|---|---|
| paste over puts the copies just above the selected layer, in the copied order | frame.create → shape.rectangle → edit.copy → select.set → edit.pasteOver → node.get → edit.undo |
| paste over the top layer of a frame | frame.create → shape.rectangle → edit.copy → select.set → edit.pasteOver → node.get |
| paste over a middle layer on the page | shape.rectangle → edit.copy → select.set → edit.pasteOver → node.get |
| paste over uses the first selected layer | frame.create → shape.rectangle → edit.copy → select.set → edit.pasteOver → node.get |
| paste over in an auto layout frame puts the copy after the selected item | frame.create → shape.rectangle → edit.copy → select.set → edit.pasteOver → node.get |
| paste over with nothing selected goes on the page | frame.create → shape.rectangle → edit.copy → select.set → edit.pasteOver → node.get |
| a frame pasted over a layer inside a frame nests above it | frame.create → shape.rectangle → edit.copy → select.set → edit.pasteOver → node.get |
| paste with the original in view lands in place above it | shape.rectangle → edit.copy → view.set → edit.paste → node.get |
| paste with the original off screen lands at the view centre | shape.rectangle → edit.copy → view.set → edit.paste → node.get |
| paste into a selected far frame lands at its centre | shape.rectangle → edit.copy → frame.create → select.set → edit.paste → node.get |
| paste into a selected frame holding the original keeps its place | shape.rectangle → edit.copy → frame.create → select.set → edit.paste → node.get |

The first restates `crates/engine/src/tests.rs::paste_over_puts_the_copies_just_above_the_selected_layer`, and the last four the placement cases of `crates/engine/src/design_paste_tests.rs`. The six between were added: the top layer, the page, several selected layers, an auto layout frame, an empty selection and a pasted frame.

## What the observations showed about the port

- Before the change the port appended the copies to the parent. Five sequences disagreed: every paste over a layer that is not the top one.
- With the copies inserted at the selected layer's index plus one, all eleven match receipt for receipt.
- The four placement rules already matched: in place when the original is in view, at the view's centre when it is off screen, in a selected far frame's centre, and in place inside a selected frame that holds the original.
- `node.get` has no `parent` field in native; a first run that asked for one was refused, and the parent is read from its `children` instead.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
