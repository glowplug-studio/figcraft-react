# Native observations for stickies and shapes with text

Data: [native-board-shapes.json](native-board-shapes.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`commands` and `receipts`: `file.newBoard`, then each of the 23 board shapes twice. The first time it is made with its default size and its own id as text; the second time at 220 × 90 in blue, without text. Then come a short yellow sticky, and a long pink sticky with no author at text size 24. `document` is the `document.json` of the save that ends the run.

`refusals` is a second run with native's answer to each command:

- a board command on a design file;
- an unknown shape;
- a colour name native accepts;
- out-of-range text size and width;
- `setColor` and `setStyle` with nothing selected;
- `nextSticky` from the selection and from a page;
- a prototype command on a board;
- an unknown parameter.

Native's headless engine measures no text: its text heights are a line's (font size × 1.2), so the sticky's growth and a shape's text centring are not observed here.
