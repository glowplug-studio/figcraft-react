# Native observations for a vector point's corner radius in .fig files (upstream a6be897d)

Data: [native-fig-point-radius.json](native-fig-point-radius.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Five export cases and two import cases. Files travel as base64 in the receipts, so nothing is written to disk. Every case draws a 100 by 100 square with `vector.create` (layer 2).

| Export case | Commands after drawing | Points' radii | Layer radius | After export and reopening |
|---|---|---|---|---|
| sharp points on a rounded vector | `node.set {cornerRadius: 8}`, then `vector.edit.cornerRadius {radius: 0, vertices: [1, 3]}` in edit mode | 8, 0, 8, 0 | 8 | 8, 0, 8, 0 |
| a rounded vector | `node.set {cornerRadius: 8}` | 8, 8, 8, 8 | 8 | The same |
| points with radii of their own on a sharp vector | `vector.edit.cornerRadius` 20 on point 0 and 10 on point 2 | 20, 0, 10, 0 | None | The same |
| a point with another radius than the layer's | `node.set {cornerRadius: 8}`, then `vector.edit.cornerRadius {radius: 3, vertices: [1]}` | 8, 3, 8, 8 | 8 | The same |
| a sharp vector | None | 0, 0, 0, 0 | None | The same |

The radii are read with `vector.edit.state` and the layer's with `node.get`. Each case holds the drawing as native saved it (`source`), native's `.fig` (`fig`) with its warnings, and the `.fig` opened natively again by a second run (`file.open {data, name: "Exported.fig"}`, then `node.get`, `vector.edit.begin`, `vector.edit.state` and `vector.edit.end` on layer 3, then `file.saveAs {data: true}`): its warnings, radii and saved document (`reopened`).

| Import case | The file | Native reads |
|---|---|---|
| two points without a radius of their own under a rounded layer | The first export case's `source`, written as `.fig` by the port before this change: points 0 and 2 carry 8, points 1 and 3 carry no radius, the layer carries 8 | 8, 8, 8, 8 |
| no point with a radius of its own under a rounded layer | The last export case's `source` with the layer's radius set to 8, written the same way: no point carries a radius | 8, 8, 8, 8 |

Native's own export always writes a point's radius on a rounded vector at this revision, so it cannot produce these two files. They were written by the port's `.fig` writer at React `f5f81e2`, before the export half of this change, and opened natively as `Crafted.fig` with the same steps as a reopening. Each holds the file (`fig`), native's warnings, radii and the document as saved (`opened`). The files are inputs; what native reads from them is the observation.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`. For an export case the commands are the case's `commands`; for a reopening or an import case, pass the file's base64 to `file.open` as above.
