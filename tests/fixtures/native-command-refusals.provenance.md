# Native observations for command parameter refusals (upstream 04a6c76a, 0ff3a368, 82da8f51, 10d97e27, 6222fce8, db1bec08, 386c6c1d)

Data: [native-command-refusals.json](native-command-refusals.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Six command sequences through `Session::execute` with every receipt, 106 steps in all, 48 of them refused. A refused command is stored as `{"error": message}`.

| Name | Steps | Refused | What is read back |
|---|---|---|---|
| node.set refuses a non-numeric miterLimit and cornerSmoothing | 20 | 9 | `node.get` `cornerSmoothing`, `miterAngle` (and `x` after a refused call that also set it) |
| node.set refuses non-numeric paragraph properties | 8 | 4 | Nothing: native has no `node.get` field for the two |
| node.reparent refuses a negative or fractional index | 21 | 4 | The frame's `children` after every accepted call |
| export sizes take plain decimals only | 26 | 15 | `node.get` `exports` before and after the eight accepted sizes |
| file.export refuses an invalid layer id instead of exporting the page | 22 | 12 | The SVG of every accepted `file.export` |
| image.savePreset refuses a negative or fractional index | 9 | 4 | The saved preset |

The sequences restate the tests the upstream commits added (`shapes_behaviour_tests.rs`, `panels_behaviour_tests.rs`, `import_export_tests.rs`, `export_behaviour_tests.rs`, `paint_tests.rs`) and add the value forms beside them: `null`, arrays, objects, booleans, numeric text, and the accepted export forms.

## What the observations showed

- `miterLimit` and `cornerSmoothing` refuse text that is not a number, `null`, an array and an object. `"12"` is 12 and `true` is 1. An accepted limit is kept between 1 and 100 and smoothing between 0 and 1. A refused call that also sets `x` leaves `x` alone.
- `paragraphSpacing` and `paragraphIndent` refuse text that is not a number and an array; `"9"` and `-3` are accepted.
- `node.reparent` refuses `-1`, `1.5` and `-0.5` as out of range and `"x"` as not a number. `true` is 1, `"1"` is 1, `99` puts the layer at the end, and `null` is the same as no index.
- An export size refuses an empty text, a bare unit, zero, a sign (`-1x`, `+2x`, `+512w`, `+0.5x`), an exponent (`2e0x`, `2E0x`), `NaNx`, `infx`, a scale over 64, a width over 16,384, an unknown unit and two units. `2x`, `512w`, `0.5x`, `@2x`, `100h`, `2`, `1.5X` and ` 3x ` are accepted.
- `file.export` and `file.exportLayers` refuse `ids: ["abc"]`, `id: "abc"`, `ids: [2, "abc"]`, `ids: [null]`, `ids: "2"` and a missing layer. An empty `ids` with a bad `id` and no selection is "nothing is selected". `ids: [2]`, `id: 2`, `id: "2"`, `ids: ["2"]`, both keys `null`, no keys and an empty `ids` all export.
- `image.savePreset` refuses `-1` and `1.5` as out of range and `"x"` as not a number. Index 0 names a solid paint here, so there is no image to read. Index 1 and `null` save the preset.

`file.exportLayers` was observed for the refusals only. `file.openRecent` was not observed: the browser keeps no recent files and the port refuses every index.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
