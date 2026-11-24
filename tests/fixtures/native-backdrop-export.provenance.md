# Native observations for a background blur or glass exported on its own (upstream 020388cf, a1de7dcd)

Data: [native-backdrop-export.json](native-backdrop-export.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Eight scenes. Each case's `scene` builds it with commands; `alone` is the `file.export` of the pane as PNG at the default contents only, and `page` the same with `contentsOnly: false`, which draws the page's layers in the same area and is the page render the native tests compare against. `alonePng` and `pagePng` are native's files.

The first five restate the native tests of `crates/engine/src/export_behaviour_tests.rs`: a red `#E03030` square at (0,0) 120 wide and a fill-less pane at (60,20) 120 by 80.

| Case | Scene | What native gives for the pane alone |
|---|---|---|
| a background blur layer keeps the blurred backdrop | Pane with a background blur of radius 12 | 120×80; at (60,40) the same as the page render, 225,45,45,118 |
| a glass layer keeps the backdrop it bends | Pane with default glass | At (30,40) and (60,40) the same as the page render |
| a blur export is opaque inside the pane and leaves layers above out | The blur scene with a blue square 200 wide above | (10,40) opaque red 224,48,48,255; (110,40) clear; the page render is all blue |
| a layer without backdrop effects still leaves the layers below out | Pane with no effect | Every pixel clear |
| a blurred pane inside a frame keeps the frame and the layer beneath | Both inside a white frame 300 by 200 at the origin | (60,40) as the page render; (100,40) opaque white |
| the source ends just outside the pane's left edge | The square 59 wide | (10,40) 204,0,0,5: the blur borrows a trace of the red outside the pane, which the page render does not draw |
| two roots, the upper pane listed first, a blue layer between | A second blurred pane at (0,130) 120 by 40 and a blue square at (150,0) 40 by 40 between them in paint order; both panes exported, the upper listed first | 180×150; the lower pane reads the red under it, not the blue painted above that pane |
| a blur export at scale 2 | The first scene at `scale: 2` | 240×160 |

## Reproduction outside the port runtime

Run the `replay` executable with `[{"name", "commands": [...scene, ["file.export", alone], ["file.export", page]]}]` and decode the base64 `data` of each export receipt.
