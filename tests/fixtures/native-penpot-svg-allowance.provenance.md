# Native observations for the Penpot raw SVG layer allowance (upstream 2f8dd85f, cf77dfda)

Data: [native-penpot-svg-allowance.json](native-penpot-svg-allowance.json); files rebuilt by `penpotSvgAllowance` in [raster-export.ts](raster-export.ts).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Two Penpot files built for the observation from the layout of the corpus file `tests-raw_svg_from_export_is_preserved_for_native_svg_expansion-0.penpot` (in `native-penpot-files.zip`): one page whose root frame lists one `svg-raw` shape per entry of `svgs`, each 40 by 25 at x = 50 × its index, named as the entry says, with raw markup of that many `<rect width="1" height="1"/>` (126,069 bytes for 4,500, under native's 128 KiB raw limit per layer and its 8 MiB budget per file). Each was opened natively with `file.open {data, name: "Allowance.penpot"}` and saved with `file.saveAs {data: true}`.

| Case | Native |
|---|---|
| 23 SVGs of 4,500 rectangles | 22 expand (99,022 layers); the 23rd would add 4,501 more than the 978 left and is taken out again: `not-expanded`, no children, the note `Penpot SVG 'S22': not converted, the file's SVG layers are over the limit; the original markup is preserved`. 99,045 layers, next id 103,548 (the taken-out import used its ids) |
| 3 SVGs of 4,500 rectangles | All three expand; 13,506 layers |

The fixture keeps the open receipt's `warnings` and `layers`, the saved document's node count and `next_id`, and each placeholder's status and child count, in id order; the documents themselves are too large to keep.

## Reproduction outside the port runtime

Build the archive as `penpotSvgAllowance` does, base64-encode it and pass it to `file.open` with the name `Allowance.penpot`, then `file.saveAs {data: true}` and read `document.json` from the saved ZIP.
