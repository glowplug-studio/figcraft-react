# Native observations for a page's prototype background in .fig files (upstream fb9df220)

Data: [native-fig-prototype-background.json](native-fig-prototype-background.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Three export cases and five REST cases. Files travel as base64 in the receipts, so nothing is written to disk.

| Case | Commands | What it shows |
|---|---|---|
| a set background | `proto.settings {background: "#336699"}`, a rectangle, `file.saveAs {data: true}`, `file.export {format: "fig"}` | The export has no warning; opened natively again, `proto.settings` reads `#336699` |
| the default background | A rectangle, then the same save and export | No warning; reopened, the background is `#1E1E1E`. The written record holds the colour |
| a translucent background | `proto.settings {background: "#33669980"}`, then the same | The export warns `a prototype background's opacity was left out`; reopened, the background is `#336699` |

Each export case holds the drawing as native saved it (`source`), native's `.fig` (`fig`) with its warnings, and the `.fig` opened natively again by a second run (`file.open {data, name: "Exported.fig"}`, `proto.settings {}`, `file.saveAs {data: true}`): its warnings, settings and saved document (`reopened`).

`deviceWarnings` records a fourth export, with the device `iPhone 17` set beside the background: native warns `prototype device settings were left out`. The port's page holds no device, so this case is not compared.

| REST case | `prototypeBackgrounds` of the page | Background native reads |
|---|---|---|
| a background | One opaque colour | `#336699` |
| a translucent background reads opaque | The colour with alpha 0.5 | `#336699` |
| an alpha of 0 is no background | The colour with alpha 0 | `#1E1E1E`, the default |
| no field | Absent | `#1E1E1E` |
| the first of two | The colour, then white | `#336699` |

Each REST case holds the file JSON (`file`), opened natively as `Page.json`, with its warnings, `proto.settings` and the document as saved (`opened`).

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`. For an export case the commands are the case's `commands`; for the reopening, pass the `data` of the export receipt to `file.open` as above. For a REST case, pass the base64 of the `file` JSON to `file.open` with the name `Page.json`.
