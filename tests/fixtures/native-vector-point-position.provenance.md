# Native observations for point positions in vector edit mode (upstream 6ac20c7d, 8edcc02a, dc841f85)

Data: [native-vector-point-position.json](native-vector-point-position.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Eleven command sequences through `Session::execute` with every receipt. Each starts with `shape.rectangle` and `vector.edit.begin`, and records `vector.edit.state` (kept as `network` and `mirroring`) and `node.get` before and after each `vector.edit.position`. A refused command is stored as `{"error": message}`.

| Name | Setup | Position commands, in order |
|---|---|---|
| a number sets every selected point's own coordinate | rectangle at 0, 0, 100 × 100; selected points [0, 1] | `{"x": -200}` |
| one point sets its own coordinates | rectangle at 0, 0, 100 × 100; selected points [2] | `{"x": 7, "y": 9}` |
| relative edits apply to each point's own value | rectangle at 0, 0, 100 × 100; selected points [0, 1] | `{"x": {"add": 10}}`; `{"y": {"mul": 2}}`; `{"x": {"div": 2}}` |
| a point keeps its handles relative to it | rectangle at 0, 0, 100 × 100, point 1 smoothed; selected points [0, 1] | `{"x": {"add": 25}}` |
| the values are in the parent's coordinates | rectangle at 40, 30, 100 × 100; selected points [0, 1] | `{"x": 10}` |
| a rotated layer's points take the parent's x | rectangle at 40, 30, 100 × 60, rotated 30°; selected points [0, 2] | `{"x": 10}`; `{"y": {"add": 5}}` |
| moving every point by one offset | rectangle at 0, 0, 100 × 100; selected points [0, 1, 2, 3] | `{"x": {"add": 10}}`; `{"x": 5, "y": {"mul": 0.5}}` |
| selected segments move their end points | rectangle at 0, 0, 100 × 100; selected segments [1] | `{"y": {"add": -20}}` |
| junk is refused and changes nothing | rectangle at 0, 0, 100 × 100; selected points [0, 1] | `{"x": {"div": 0}}`; `{"x": {"pow": 2}}`; `{"x": "a"}`; `{"x": {"add": 1, "mul": 2}}`; `{"y": {"add": "x"}}`; `{"x": {}}`; `{"x": [1]}`; `{"x": true}`; `{"x": {"add": true}}`; `{"x": 5, "y": {"div": 0}}`; `{"x": {"mul": 1e+308}}`; `{"z": 4}`; `{"x": {"add": null}}`; `{"x": {"mul": "2"}}`; `{"x": 5}` |
| nothing selected is refused | rectangle at 0, 0, 100 × 100; selected points [] | `{"x": 5}` |
| a numeric string and a null are read as native reads parameters | rectangle at 0, 0, 100 × 100; selected points [0, 1] | `{"x": "12"}`; `{"x": null, "y": 3}` |

The first five, the junk case and the empty selection restate `crates/engine/src/canvas/vectoredit/position_tests.rs`. A rotated layer, every point moved, selected segments and the parameter forms were added.

## What the observations showed

- A number sets every selected point's own coordinate in the parent's coordinates, also for a rotated layer, where the points' local coordinates change on both axes.
- `{add}`, `{mul}` and `{div}` apply to each point's own value; a selected segment contributes its two end points.
- Fourteen malformed parameters are refused and change nothing: a zero divisor, an unknown operation, text that is not a number, two operations at once, a non-number operand, an empty object, an array, a boolean, a boolean operand, a refused second axis beside a valid first, an overflowing product, an unknown key, a null operand and a text operand.
- A numeric string is read as a number and a null axis is left alone, as native's parameter reader does everywhere.
- A position command that moves nothing still succeeds in native and takes an undo step there. The first run of the junk case ended with such commands and an undo, which undid the empty step. That is a property of the native history, not of this command, so the fixture's junk case ends with a real move and its undo instead. The port records no step for a command that changes nothing (probed with the same commands); whether it should is added to the final-audit queue.
- Before the change the port moved the selection as a group so that its top-left landed on the typed value, ignored relative forms and accepted the malformed ones: nine of the eleven sequences disagreed.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
