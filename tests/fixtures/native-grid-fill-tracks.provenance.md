# Native observations for grid Fill tracks (upstream a28c03d9, 92753a8f, daa6b5b2)

Data: [native-grid-fill-tracks.json](native-grid-fill-tracks.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Eight grids, each opened from a plain JSON document (a page, frame 2 in grid mode with no padding, and rectangles from 3), laid out by widening the frame by one and setting it back.

| Case | Native result |
|---|---|
| 100 × 100, rows 1fr / 1fr, a fixed 20 × 80 child and a Fill-height child | Rows stay 50 / 50: the first overflows into row 2, the second sits at y 50, 50 tall |
| The same with fixed children 80 and 70 tall | Second child at y 50 (the grid overflows) |
| 300 × 20, columns 1fr / 2fr, a fixed 150-wide child and a Fill-width child | Columns stay 100 / 200: the second at x 100, 200 wide |
| 300 × 200, rows 1fr / 1fr, children 150 and 20 tall | Second at y 100 |
| The same with a row gap of 10 | Second at y 105 |
| The same with the frame's height on Hug | Rows size to content: second at y 150, frame 170 |
| 100 × 100, a Fill-height child with a minimum height of 80 | Its row keeps 80: it is 80 tall, the next at y 80 |
| 300 × 200, rows Hug / 1fr, children 150 and 20 tall | The Hug row keeps 150: second at y 150 |

The first six restate native `layout::behaviour_tests::grid_rules` as changed by `a28c03d9`; the last two check the unchanged Fill-minimum and Hug-track rules.

## Reproduction outside the port runtime

Run `replay` with `[{"name", "commands": [["file.open", {"data": <base64 JSON>, "name": "grid.figcraft"}], ["node.set", {"id": 2, "props": {"width": w + 1}}], ["node.set", {"id": 2, "props": {"width": w}}], ["node.get", {"id": 2}], …]}]`.

## Older fixtures re-pinned at this revision

`a28c03d9` changed three of native's own `grid_rules` cases, so two older fixtures that copied native at an earlier revision were brought to `bad07e44` by native observation:

- [native-layout-rules.json](native-layout-rules.json), a copy of native `layout::behaviour_tests` from 9 November: the three changed `fr` cases take native's new names and rectangles (rows 50 / 50 with the first child overflowing; columns 100 / 200), and native's three new measured cases are added (300 × 200 at y 100; with a row gap at y 105; with the frame on Hug at y 150 and frame 170). The first three cases of this file's own data observe the same grids natively today and give the same rectangles.
- [native-flow-layout.json](native-flow-layout.json), case "horizontal wrapped baselines": its inner frame is a one-column grid of fixed width holding a hug-width text and a fixed rectangle. Replayed natively with the five packaged font files loaded by `text.loadFont` (the other three cases reproduce their recorded values exactly this way, and so do this case's other four layers), the two grid children now sit at (−2, −13.5) and (−23.5, −1), where they were (23.5, 1) and (2, 45). The text's recorded height of 124.134765625 is kept: `node.get` rounds it to 124.13. The case "vertical auto gap" was left as recorded: replayed this way its widths differ by a text width of 14, which the font build accounts for, not layout.
