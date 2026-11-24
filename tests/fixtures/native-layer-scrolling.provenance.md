# Native observations for a layer's overflow and scroll position

Data: [native-layer-scrolling.json](native-layer-scrolling.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

A frame and a rectangle inside it. `node.set` sets the frame's overflow to vertical, both and `Horizontal` (any case), refuses `sideways`; sets the rectangle's scroll position to fixed and sticky, refuses `floating`, and gives the rectangle an overflow too. At the first save the frame holds `overflow: horizontal` and the rectangle `overflow: vertical` and `scroll_position: sticky`; setting the defaults back removes the frame's overflow and the rectangle's scroll position at the second save. `document` is the first save, which the browser case opens. (A group created in the native run is left out: it played no part.)
