# Native observations for the Invert zoom direction preference (upstream 6fce958a, 1ef0c16f)

Data: [native-invert-zoom.json](native-invert-zoom.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Two command sequences, 17 steps, one of them refused.

| Sequence | What it shows |
|---|---|
| pref.invertZoom toggles and sets the preference | With no parameters it toggles: on, then off. `on: true` and `on: false` set it; `"yes"` and `0` are read as on and off. A value that is not a boolean, `"maybe"` or `null`, toggles. An unknown parameter is refused, with the message naming it |
| the preference does not change the zoom commands | With the preference on, `view.zoomIn`, `view.zoomOut` and `view.zoomAt` zoom as they do with it off |

The wheel itself is handled in native's interface crate (`crates/ui-egui/src/canvas/input.rs`), which the oracle does not drive. The port's wheel tests restate `crates/ui-egui/src/canvas/wheel_zoom_tests.rs`.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
