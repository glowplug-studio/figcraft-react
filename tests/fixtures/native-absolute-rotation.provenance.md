# Native observations for a layer's rotation on the page (upstream d0379dc7, cc367717; #2196)

Data: [native-absolute-rotation.json](native-absolute-rotation.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 20 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Ten command sequences through `Session::execute` with every receipt. Each builds frames, groups and rectangles, applies `node.set`, and reads the layers with `node.get` (`type`, `x`, `y`, `width`, `height`, `rotation`, `absoluteBounds`). `rotation` is the angle to the parent; the page angle shows in `absoluteBounds`. A refused command is stored as `{"error": message}`.

| Name | `node.set` properties, in order |
|---|---|
| absoluteRotation sets the rotation on the page, keeping the centre | `{"rotation": 10}`; `{"absoluteRotation": 7}`; `{"absoluteRotation": 0}` |
| a layer in a rotated group takes the page angle and its sibling keeps its own | `{"rotation": 10}`; `{"absoluteRotation": 7}` |
| several layers take one page angle in one undo step | `{"rotation": 10}`; `{"absoluteRotation": 45}` |
| a flip is kept | `{"rotation": 10}`; `{"absoluteRotation": 30}` |
| rotation and absoluteRotation together are refused | `{"rotation": 10}`; `{"rotation": 1, "absoluteRotation": 2}`; `{"absoluteRotation": "abc"}`; `{"absoluteRotation": true}`; `{"absoluteRotation": "45"}` |
| a frame and a layer inside it both land on the page angle | `{"rotation": 10}`; `{"absoluteRotation": 45}` |
| the frame listed first lands both on the page angle too | `{"rotation": 10}`; `{"absoluteRotation": 45}` |
| absoluteRotation turns about a moved rotation origin | `{"absoluteRotation": 30}` |
| a top-level layer's page angle is its own angle | `{"absoluteRotation": 25}`; `{"rotation": -40}`; `{"absoluteRotation": -170}` |
| nested rotated frames | `{"rotation": 20}`; `{"rotation": 15}`; `{"absoluteRotation": 90}`; `{"absoluteRotation": 35, "x": 10}` |

The first, second, third, fourth and fifth restate `crates/engine/src/transform_behaviour_tests.rs::absolute_rotation_sets_the_rotation_on_the_page_keeping_the_centre`, split by what each part shows. The sixth restates `absolute_rotation_on_a_frame_and_a_layer_inside_it_lands_both_on_the_page_angle`, and the eighth `crates/engine/src/rotation_origin_tests.rs::the_absolute_rotation_key_turns_about_a_moved_origin_too`. The frame listed first, a top-level layer, nested rotated frames and the value forms were added.

## What the observations showed

- A layer in a frame turned 10 degrees and set to 7 on the page reads -3 to its parent, and its centre stays put.
- A frame and a layer inside it set together both land on the page angle whichever is listed first.
- Giving both keys is refused, and so is text that is not a number. `true` is read as 1 degree and `"45"` as 45, as native's number reader does everywhere.
- With `x` in the same call the rotation is applied first and the position after it.
- The port had no `absoluteRotation` key: all ten sequences were refused at their first use of it.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
