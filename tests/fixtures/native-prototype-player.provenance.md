# Native observations for prototype player requests and unknown parameters

Data: [native-prototype-player.json](native-prototype-player.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Three command sequences, each step with its parameters and native's receipt or error.

| Sequence | What it covers |
|---|---|
| `player` | No frame to present; the first frame in reading order; the first flow; a layer inside a frame; a layer outside any frame and a missing layer refused; a non-numeric start falling back; the selection; closing the preview; presentation options and their refusals; the link notice preference with lenient booleans |
| `unknown` | Unknown parameters refused on interaction, flow, settings, evaluate, action, removal, options, link notice and present commands, including a camelCase spelling native does not take at the top level |
| `takes` | Every proto command's list of the parameters it takes, and the plural message for two unknown ones |
