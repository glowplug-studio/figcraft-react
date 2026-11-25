# Native observations for connectors

Data: [native-board-connectors.json](native-board-connectors.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`steps` lists each command with native's result. On a new board come three shapes and six connectors:

- straight;
- elbow from bottom to bottom;
- curved, with a label;
- elbow from a free point to a spot placed by hand on a shape, with other caps;
- from a shape to a free point;
- elbow from right to left.

Then a label is added to the first connector, and its end is reattached to the top of the third shape. One shape is moved with `node.set`, so the connectors to it re-route. The label's text changes, and the second connector is restyled as curved with another end cap and recoloured red. The board is saved (`documents[0]`). Finally the third shape is deleted with `edit.delete`: the ends that joined it are left as points where they were drawn, and the board is saved again (`documents[1]`).

Native's headless engine measures no text, so a label's size is a padding box; the port's labels are compared by their middles.
