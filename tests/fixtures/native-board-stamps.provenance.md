# Native observations for stamps and ink

Data: [native-board-stamps.json](native-board-stamps.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`commands` and `results` are native's answer to each command on a new board. A sticky and a shape are made. Each of the six stamps is placed on the sticky, and a default stamp is placed on nothing; native refuses an unknown stamp. A marker stroke is drawn through points and a pink highlighter stroke along a path; native refuses ink with neither. The sticky is moved with `node.set`, and the stamps on it go with it. `document` is the `document.json` of the save that ends the run.
