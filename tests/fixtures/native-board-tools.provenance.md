# Native observations for the board tools

Data: [native-board-tools.json](native-board-tools.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`runs` holds two runs, each with `commands` and native's `results`:

1. **The tools.** A board tool chosen in a design file; each board tool chosen on a new board with its choice (a sticky colour, a shape, a routing, the inks, a stamp in either case); the refusals for an unknown colour, shape, routing and stamp, a number or a boolean for a choice, and a parameter the eraser doesn't take; Move again; a sticky, a shape and a stamp placed by command.
2. **Unknown parameters.** Each board tool and each facilitation command given a parameter it doesn't take (refused, naming what it takes), and given `id` or `ids` (always taken).
