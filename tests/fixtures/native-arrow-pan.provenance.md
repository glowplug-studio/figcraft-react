# Native observations for the arrow-key pan (upstream 75f54e0a, d036eb2f, 9f51517f)

Data: [native-arrow-pan.json](native-arrow-pan.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Twelve command sequences, 34 steps. Each sets the view with `view.set {zoom, cx, cy}` and calls `view.pan`, whose receipt is the view's new centre, `{cx, cy}`. No step was refused.

| Sequence | What it shows |
|---|---|
| the arrows pan 64 screen pixels, and 320 with Shift | From (300, 200) at 100%: right to (364, 200), up with `big` to (364, -120), and back |
| at zoom 2.0 and 0.5, one step on each axis, with and without `big` (four sequences) | 32 and 128 page units for one step, 160 and 640 with `big`: the same screen distance at any zoom |
| at zoom 1.0, each direction, with and without `big` (six sequences) | 64 and 320 page units, signed by the direction |
| several steps, both axes, limits and lenient values | `{dx: 3, dy: -2}` moves by 192 and -128; `dx: 1000` with `big` is held to 100 steps (32,000); half a step moves 32; `big: "YES"` counts as `big`; `dx: "2"` is two steps; no parameters, text that is not a number and `null` move nothing |

The first eleven restate the two tests in `crates/engine/src/cmd/view.rs` (`the_arrows_pan_64_px_and_320_with_shift_as_measured_in_figma` and `the_arrow_pan_is_the_same_screen_distance_at_any_zoom_on_both_axes`, with its ten cases). The last was added.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
