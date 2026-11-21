# Native observations for Zoom to selection (upstream fceb6063, 5d529269, 53bf0a40)

Data: [native-zoom-selection.json](native-zoom-selection.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Eleven command sequences, 70 steps. Each makes one or more shapes, selects, sets the canvas size and the strip the toolbar covers with `view.set {vw, vh, bottomInset}`, runs `view.zoomSelection` or `view.zoomFit`, and reads the view with `view.get`. No step was refused.

| Sequence | Canvas, inset | View after the zoom |
|---|---|---|
| a 40 point margin on every side of the area above the toolbar | 1389 by 903, 58 | A 100 by 100 selection: zoom 7.65, centre (50, 53.79) |
| a wide selection is limited by the width | 1389 by 903, 58 | 1000 by 200: zoom 1.309, centre (500, 122.15) |
| with no toolbar the selection is centred in the whole canvas | 1389 by 903, 0 | Zoom 8.23, centre (50, 50) |
| a short canvas keeps the selection above the toolbar | 1389 by 130, 60 | Zoom 0.35, centre (50, 135.71) |
| a narrow canvas keeps a quarter of its width as margin | 100 by 903, 0 | Zoom 0.5, centre (50, 50) |
| an inset taller than the canvas is held to one point less | 400 by 300, 5000 | Zoom 0.02, the lowest |
| the inset is clamped and not part of the view that is read back | default | `view.get` has no inset among its keys after -5, 1e12 and text |
| a line and a tiny and a huge selection | 1000 by 800, 100 | A 100 wide line: zoom 9.2; 0.001 square: 256, the highest; ten million square: 0.02 |
| zoom to fit is unchanged by the inset | 1389 by 903, 58 | Zoom 7.75, centre (50, 50): a 64 point margin in the whole canvas |
| with nothing selected zoom to selection leaves the view | 1389 by 903, 58 | Zoom 2, centre (10, 20), as set |
| the default view and a selection off the origin | 1200 by 800, 0 | 40 square at (900, 0): zoom 18, centre (920, 20); 640 by 480: 1.5; both: 0.778 |

The sequences restate `crates/engine/src/view_behaviour_tests.rs` (`zoom_to_fit_selection_and_frames`, the margin and short- and narrow-canvas tests, the line, tiny and huge rectangles, and `the_bottom_inset_is_clamped_and_never_saved`) at the command level.

## What the observations showed

- The fit leaves 40 points on each side of the area above the toolbar: for a 100 square in 1389 by 903 with a 58 point strip the zoom is (903 - 58 - 80) / 100 = 7.65.
- The selection's centre lands in the middle of that area, so the view's centre is below it by half the strip in page units: 29 / 7.65 = 3.79.
- When 40 points do not fit, the margin is a quarter of the area: a canvas 130 high with a 60 point strip leaves 17.5 above and below.
- `view.get` never gives the inset back.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands` in the fixture.
