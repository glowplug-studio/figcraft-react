# Native observations for Tidy up (upstream cfd6bf52, d3f7ae90, a7a9e627, 1a68ded5)

Data: [native-tidy-up.json](native-tidy-up.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Forty-five command sequences through `Session::execute` with every receipt. Each creates rectangles (x, y, width × height below), runs `arrange.tidy`, reads every layer with `node.get`, undoes once and reads every layer again. After a Tidy up that moved nothing the undo removes the last rectangle instead, which the fixture records as a `null` receipt: that is how it shows that no undo step was added.

| Name | Rectangles | Tidy up |
|---|---|---|
| a row keeps its order, sizes and Y and evens the gaps | 0, 0, 50 × 30; 80, 10, 70 × 50; 190, -5, 40 × 40; 260, 8, 60 × 20 | no spacing |
| gaps that all differ take their mean | 0, 0, 50 × 30; 130, 10, 70 × 50; 220, -5, 40 × 40; 305, 8, 60 × 20 | no spacing |
| gaps 30, 40 and 21 | 0, 0, 50 × 30; 80, 10, 70 × 50; 190, -5, 49 × 50; 260, 8, 60 × 20 | no spacing |
| a column keeps X and evens the vertical gaps | 0, 0, 50 × 30; 8, 60, 70 × 50; -5, 150, 40 × 40; 6, 220, 60 × 20 | no spacing |
| the most common gap, else the mean: case 1 | 0, 0, 50 × 50; 60, 0, 50 × 50; 160, 0, 50 × 50 | no spacing |
| the most common gap, else the mean: case 2 | 0, 0, 50 × 50; 100, 0, 50 × 50; 160, 0, 50 × 50 | no spacing |
| the most common gap, else the mean: case 3 | 0, 0, 50 × 50; 70, 0, 50 × 50; 140, 0, 50 × 50 | no spacing |
| the most common gap, else the mean: case 4 | 0, 0, 50 × 50; 50, 0, 50 × 50; 160, 0, 50 × 50 | no spacing |
| the most common gap, else the mean: case 5 | 0, 0, 50 × 50; 60, 0, 50 × 50; 120, 0, 50 × 50; 240, 0, 50 × 50 | no spacing |
| the most common gap, else the mean: case 6 | 0, 0, 50 × 50; 70, 0, 100 × 50; 210, 0, 30 × 50 | no spacing |
| the most common gap, else the mean: case 7 | 0, 0, 50 × 50; 60, 0, 50 × 50; 120, 0, 50 × 50; 220, 0, 50 × 50; 360, 0, 50 × 50 | no spacing |
| a grid is tidied by columns | 0, 0, 50 × 30; 80, 5, 70 × 50; 190, -3, 40 × 40; 2, 90, 60 × 20; 85, 95, 40 × 50; 200, 92, 55 × 35 | no spacing |
| a transposed grid is tidied by rows | 0, 0, 30 × 50; 5, 80, 50 × 70; -3, 190, 40 × 40; 90, 2, 20 × 60; 95, 85, 50 × 40; 92, 200, 35 × 55 | no spacing |
| two layers are left alone | 0, 0, 50 × 50; 87, 0, 50 × 50 | no spacing |
| an overlapping triple is left alone | 100, 460, 50 × 30; 140, 430, 80 × 60; 130, 400, 30 × 90 | no spacing |
| a tidy that moves nothing | 0, 0, 50 × 50; 70, 0, 50 × 50; 140, 0, 50 × 50 | no spacing |
| two equally common gaps give the smaller | 0, 0, 50 × 50; 60, 0, 50 × 50; 120, 0, 50 × 50; 220, 0, 50 × 50; 320, 0, 50 × 50 | no spacing |
| a mean of 17.5 goes up | 0, 0, 50 × 50; 60, 0, 50 × 50; 135, 0, 50 × 50 | no spacing |
| a mean of 21.67 goes to 22 | 0, 0, 50 × 50; 60, 0, 50 × 50; 135, 0, 50 × 50; 215, 0, 50 × 50 | no spacing |
| layers on a diagonal are left alone | 0, 0, 50 × 50; 60, 70, 50 × 50; 140, 150, 50 × 50 | no spacing |
| a grid with an empty place is left alone | 0, 0, 50 × 50; 70, 0, 50 × 50; 150, 0, 50 × 50; 0, 80, 50 × 50; 72, 90, 50 × 50 | no spacing |
| an overlapping pair's negative gap counts | 0, 0, 50 × 50; 60, 0, 50 × 50; 105, 0, 50 × 50; 170, 0, 50 × 50 | no spacing |
| an irregular selection is left alone | 0, 0, 200 × 30; 0, 50, 90 × 50; 110, 50, 90 × 50 | no spacing |
| spacing sets the gap | 0, 0, 50 × 50; 60, 0, 50 × 50; 160, 0, 50 × 50 | spacing 12 |
| spacing takes two layers | 0, 0, 50 × 50; 87, 0, 50 × 50 | spacing 12 |
| without pixel snapping a centred layer keeps its half pixel | 0, 0, 50 × 30; 80, 5, 70 × 50; 190, -3, 40 × 40; 2, 90, 60 × 20; 85, 95, 40 × 50; 200, 92, 55 × 35 | no spacing; also view.snapPixel |
| a rotated layer is tidied by its box | 0, 0, 50 × 50; 80, 0, 40 × 40; 200, 0, 50 × 50 | no spacing; also node.set |
| a row whose layers overlap in a chain | 0, 0, 50 × 50; 40, 0, 50 × 50; 80, 0, 50 × 50; 150, 0, 50 × 50 | no spacing |
| a negative gap is raised: widths [100, 10, 100, 100, 100, 100] | 0, 0, 100 × 50; 80, 0, 10 × 50; 200, 0, 100 × 50; 260, 0, 100 × 50; 400, 0, 100 × 50; 460, 0, 100 × 50 | no spacing |
| a negative gap is raised: widths [100, 20, 100, 100, 100, 100] | 0, 0, 100 × 50; 80, 0, 20 × 50; 200, 0, 100 × 50; 260, 0, 100 × 50; 400, 0, 100 × 50; 460, 0, 100 × 50 | no spacing |
| a negative gap is raised: widths [100, 30, 100, 100, 100, 100] | 0, 0, 100 × 50; 80, 0, 30 × 50; 200, 0, 100 × 50; 260, 0, 100 × 50; 400, 0, 100 × 50; 460, 0, 100 × 50 | no spacing |
| a negative gap is raised: widths [100, 100, 100, 10, 100, 100] | 0, 0, 100 × 50; 80, 0, 100 × 50; 200, 0, 100 × 50; 260, 0, 10 × 50; 400, 0, 100 × 50; 460, 0, 100 × 50 | no spacing |
| a narrow first layer keeps the second after it | 0, 0, 10 × 50; 80, 0, 100 × 50; 200, 0, 100 × 50; 260, 0, 100 × 50; 400, 0, 100 × 50; 460, 0, 100 × 50 | no spacing |
| a negative gap between equal widths | 0, 0, 100 × 50; 80, 0, 100 × 50; 200, 0, 100 × 50; 260, 0, 100 × 50; 400, 0, 100 × 50; 460, 0, 100 × 50 | no spacing |
| an explicit spacing is not raised | 0, 0, 100 × 50; 80, 0, 10 × 50; 200, 0, 100 × 50 | spacing -40 |
| a two by two grid | 0, 0, 50 × 30; 90, 4, 70 × 50; 3, 100, 60 × 20; 95, 90, 40 × 50 | no spacing |
| a spacing on a grid | 0, 0, 50 × 30; 80, 5, 70 × 50; 190, -3, 40 × 40; 2, 90, 60 × 20; 85, 95, 40 × 50; 200, 92, 55 × 35 | spacing 20 |
| a negative explicit spacing on a column | 0, 0, 50 × 30; 8, 60, 70 × 50; -5, 150, 40 × 40 | spacing -10 |
| the same layer listed twice counts once | 0, 0, 50 × 50; 60, 0, 50 × 50; 160, 0, 50 × 50 | no spacing |
| a spacing past the limit is refused | 0, 0, 50 × 50; 60, 0, 50 × 50; 160, 0, 50 × 50 | spacing 1000001 |
| a spacing at the limit | 0, 0, 50 × 50; 60, 0, 50 × 50; 160, 0, 50 × 50 | spacing 1000000 |
| layers in an auto layout flow are left alone until they are absolute | –, –, 50 × 50; –, –, 50 × 50; –, –, 50 × 50 | no spacing, no spacing; also frame.create, node.set |
| layers inside a plain frame are tidied in page space | 0, 10, 50 × 50; 60, 10, 50 × 50; 160, 10, 50 × 50 | no spacing; also frame.create |
| a selected parent stands for its selected child | 0, 10, 50 × 50; 60, 10, 50 × 50; 160, 10, 50 × 50; 600, 50, 50 × 50; 700, 50, 50 × 50 | no spacing; also frame.create |
| two in a row and one below are left alone, with or without a spacing | 0, 0, 20 × 20; 40, 4, 30 × 10; 5, 100, 10 × 40 | no spacing, spacing "5px", spacing 5 |

Thirty-six of them restate `crates/engine/src/tidy_tests.rs`, one layout per sequence. A two by two grid, a spacing on a grid, a negative spacing on a column, a layer listed twice, the spacing limit, layers inside a plain frame and a selected parent with its child were added. The last sequence is the layout of an earlier port test whose expectation the upstream change replaced.

## What the observations showed about the port

- The port's earlier Tidy up placed layers on a grid of the largest width and height. It matched 12 of the first 44 sequences, those where nothing moves or the result happens to coincide.
- With the native module ported, all 45 match receipt for receipt.
- The native test file allows the two grids a pixel of slack against its Figma readings. The fixture holds the values native actually produces: 99 and 89 where the test names 98 and 88.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
