# Native observations for vector region paints in .fig export (upstream f1e92749, 98f94626)

Data: [native-fig-region-paints.json](native-fig-region-paints.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Eight export cases. Files travel as base64 in the receipts, so nothing is written to disk.

The first case draws one closed path with `vector.create`, giving a vector (id 2) with one region and no paint frame. The other seven draw two rectangles and flatten them with `vector.flatten {ids: [2, 3]}`, giving a vector (id 4) with two regions, each with a paint frame.

| Case | Commands after building the vector | What it shows |
|---|---|---|
| a drawn path's region with a colour of its own | `fill.set {regions: [0], color}` | No warning; the region names a style entry with its paint |
| one region with a colour of its own | `fill.set {regions: [0], color}` | The first region names an entry, the second writes style 0 |
| two regions with equal paints | `fill.set {regions: [0, 1], color}` | Both regions name the same entry |
| two regions with different paints | `fill.set` on each region, the second translucent | One entry each |
| a region with an empty list | `fill.set` then `fill.remove {regions: [1], index: 0}` | The region names an entry whose list is empty |
| a region with two paints | `fill.set` then `fill.add` on region 0 | The entry holds both paints |
| a region with a gradient | `fill.set {regions: [1], paint}` with a linear gradient | The entry holds the gradient |
| no region paints | None | Both regions write style 0 |

Every flattened case exports with the warning `vector region paint frames were left out (their gradients and images follow the layer's box)`, the last one included: Flatten gives each region a paint frame. No case warns on reopening.

Each case holds the drawing as native saved it (`source`), native's `.fig` (`fig`) with its warnings, and the `.fig` opened natively again by a second run (`file.open {data, name: "Exported.fig"}`, `file.saveAs {data: true}`): its warnings and saved document (`reopened`).

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`. For an export case the commands are the case's `commands`; for the reopening, pass the `data` of the export receipt to `file.open` as above.
