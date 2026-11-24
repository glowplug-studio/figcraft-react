# Native observations for an instance's own interactions

Data: [native-instance-interactions.json](native-instance-interactions.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

A component with a click-navigate is instantiated; the instance gets a hover interaction of its own; the main gets a press interaction and is renamed. At the save, the main holds its two interactions and the instance only its own: a new instance starts with none, and a change to the main does not copy the main's onto it (they play on it in prototypes instead).
