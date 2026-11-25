# Native observations for reshaped connectors and joined shapes

Data: [native-board-reshape.json](native-board-reshape.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`commands` and `results` are native's answer to each command on a new board.

- **Reshaping.** Two shapes are joined by an elbow connector, whose middle and first runs are reshaped. One shape is moved, and a curved connector's middle is reshaped. Native refuses to reshape a straight connector, a portion the connector doesn't have, and a fractional portion.
- **Joined shapes.** `board.addConnected` joins a new shape below one, and another at a point it is dropped at. It joins a sticky to the left of a green sticky taken from the selection. `board.nextSticky` from a shape joins the next shape above it. Native refuses `addConnected` from a connector and on an unknown side.
- **Restyling.** The reshaped elbow is restyled straight, which drops its path.

`document` is the `document.json` of the save that ends the run.
