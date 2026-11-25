# Native observations for mind maps

Data: [native-board-mindmap.json](native-board-mindmap.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`commands` and `results` are native's answer to each command on a new board:

- **Adding.** A mind map (Topic with Idea 1, 2 and 3) is made. A child is added to the first node, a child to Idea 1, and a sibling after Idea 1.
- **Refusals.** A sibling of the first node; a node that is a text, not a mind map node; an unknown relation; a far-off place; children that aren't a list.
- **Second map.** A second map is made with no children.
- **Deleting.** Idea 1 is deleted: its branches go and its child floats free.

`document` is the `document.json` of the save that ends the run. Native's headless engine measures no text, so its nodes are their least width; positions that follow from node widths are not compared.
