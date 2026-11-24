# Native observations for the SVG filter layer stack cap (upstream 64e91207, #2252)

Data: [native-svg-import-filter-stack.json](native-svg-import-filter-stack.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Four SVGs, each a red rectangle with a filter, imported with `file.import {data, name: "f.svg"}`; the rectangle is layer 4. `warnings` is the import receipt's and `effects` the rectangle's as `node.get` returns them.

| Case | Native |
|---|---|
| 63 shadows and the graphic (a merge of 63 `SourceAlpha` nodes and `SourceGraphic`) | 63 drop shadows, no warning: the stack holds 64 layers |
| 64 shadows and the graphic | No effects, `filter f isn't a shadow or blur: the layer is drawn without it`: 65 layers pass the cap |
| a doubling chain of merges (native's own test: 40 merges, each holding the previous result twice) | The same warning, no effects |
| an offset blurred shadow | One drop shadow, offset 3, 4, radius 4 |

## Reproduction outside the port runtime

Pass each case's `svg`, base64-encoded, to `file.import` and read `node.get` for layer 4.
