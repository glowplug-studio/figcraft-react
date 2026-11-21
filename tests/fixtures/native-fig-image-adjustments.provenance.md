# Native observations for image adjustments in .fig export (upstream b54df860, 501df234)

Data: [native-fig-image-adjustments.json](native-fig-image-adjustments.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Six export cases and one re-observation. Files travel as base64 in the receipts, so nothing is written to disk. Every case places the same 2 by 2 pixel PNG with `file.placeImage` (its base64 is in the case's commands), giving the layer with id 2.

| Case | Commands after placing the image | What it shows |
|---|---|---|
| every adjustment | `image.adjust` with all seven values | The export has no warning and writes all seven, saturation as `vibrance` and the tint with its sign turned |
| no adjustment | None | No `paintFilter` is written |
| one adjustment | `image.adjust {filters: {tint: 1}}` | All seven fields are written, the tint as -1 |
| a preset | `image.adjust {preset: "warm"}` | The preset's values are written |
| an adjustment out of range in a fills property | `node.set` with a fills list whose image has `exposure: 5` | `node.get` reads 5; the file holds 1 |
| a stroke's image | `node.set` with an image stroke with `shadows: -0.5` | A stroke's image paint is written the same way |

Each case holds the layer's adjustments as `node.get` reads them (`layer`), the drawing as native saved it (`source`), native's `.fig` (`fig`) with its warnings, and the `.fig` opened natively again by a second run (`file.open {data, name: "Exported.fig"}`, `file.saveAs {data: true}`): its warnings and saved document (`reopened`). Reopening a file with an adjustment warns `image filters use FigCraft's approximate renderer`.

`repinned` holds one drawing of the older REST corpus, "unsafe image names": its archive in [native-rest-documents.json](native-rest-documents.json) opened natively (`file.open {data, name: "Source.figcraft"}`), exported as `.fig` and reopened as above. The corpus's own export of it, in `native-fig-imports.zip`, was written before the change and left the adjustments out; at this revision the export has no warning and the reopening notes the approximate renderer seven times. The corpus file is unchanged.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`. For an export case the commands are the case's `commands`; for the reopening, pass the `data` of the export receipt to `file.open` as above.
