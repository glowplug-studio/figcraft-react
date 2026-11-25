# Native observations for the board data model

Data: [native-board-document.json](native-board-document.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`commands` is the sequence replayed and `receipts` what native returned for each. `file.newBoard` makes a board named Retro. Then come:

- a yellow sticky by Ana and a diamond shape with text;
- an elbow connector with a label;
- a free-ended curved connector attached by hand to the bottom of a layer, then reshaped;
- a heart stamp, which lands on the sticky;
- a highlighter stroke;
- a 2 × 2 table;
- a mind map with two children.

Facilitation follows. A five-minute timer is started and paused. A stickies vote with Ana's ballot is ended (and kept in the history), and a second vote is started with Bo's ballot.

`document` is the `document.json` of the `file.saveAs {data: true}` that ends the run. It has the file kind, every board item, the timer, the running vote, its ballots and the kept results. The run's timestamps are native's clock at the time of the observation.
