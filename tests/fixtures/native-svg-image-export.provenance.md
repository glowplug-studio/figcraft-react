# Native observations for SVG export embedding each image once (upstream 9032dc3e, #2250)

Data: [native-svg-image-export.json](native-svg-image-export.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Five command sequences, each ending in `file.export {ids, format: "svg"}`; `svg` is native's file. The images are two PNGs written for the observation (2 by 2 and 1 by 1 pixels), placed with `file.placeImage`; their base64 is in the commands.

| Case | What native writes |
|---|---|
| three paints of one image | One `<image id="image2">` in `defs`; three `<pattern>`s, each holding `<use href="#image2"/>` |
| two layers of one image | One image, two patterns |
| two images | Two images, each written just before its first pattern |
| an image fill and an image stroke | One image shared by the fill's and the stroke's patterns |
| one image paint | One image, one pattern; the pattern's id (`pattern1`) is taken before the image's (`image2`) |

The stroke case's stroke outline holds redundant zero-length cubics in native's output; the test removes them before comparing, as `svg-export.test.ts` does for its outside stroke.

## Reproduction outside the port runtime

Run the `replay` executable with each case's `name` and `commands` and decode the base64 `data` of the last receipt.
