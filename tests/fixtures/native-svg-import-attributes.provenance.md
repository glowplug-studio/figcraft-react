# Native observations for SVG import attribute limits (upstream 4d3fe2aa, 70ed6c16)

Data: [native-svg-import-attributes.json](native-svg-import-attributes.json); documents rebuilt by [svg-attribute-documents.ts](svg-attribute-documents.ts).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Eight SVGs imported with `file.import {data, name: "a.svg"}`. The documents are up to 1.5 MB, so the fixture keeps a recipe and the document's UTF-8 length instead of the text; `svg-attribute-documents.ts` rebuilds each exactly as the observation built it (attributes `a0="1"`, `a1="1"`, …), and the unit test checks the length.

| Case | Native |
|---|---|
| 4096 attributes on one element | Imported |
| 4097 attributes on one element | `SVG import failed: an element has more than 4096 attributes` |
| 4097 attributes on the root (4095 plus `xmlns`, `width`, `height`) | The same refusal |
| 10 elements of 4000 attributes | Imported: within the work limit (10 × 4000² < 2²⁸) |
| 40 elements of 4000 attributes | The same refusal: each element is within its limit, all together are not |
| an entity holding 5000 attributes | The same refusal: a DTD counts as one element |
| a namespace entity | Imported |
| many small elements (10,000 of two attributes) | Imported |

## Reproduction outside the port runtime

Rebuild each document from its recipe, base64-encode it and pass it to `file.import` with the name `a.svg`.
