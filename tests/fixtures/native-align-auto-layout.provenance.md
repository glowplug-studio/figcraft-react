# Native observations for Align in an auto layout flow (upstream 76965c78)

Data: [native-align-auto-layout.json](native-align-auto-layout.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

A 200 × 100 frame (2) with a horizontal auto layout, no padding and a gap of 10, holding two 20 × 20 rectangles (3 at x 0, 4 at x 30).

| Case | Native result |
|---|---|
| Each of the six align commands on rectangle 4 | Both rectangles stay at x 0 and 30; the frame's mode and alignment stay horizontal, min, min |
| Rectangle 3 made absolute, then `align.right` | It moves to x 180, its frame's right edge |
| `align.top` on both rectangles | Unchanged |
| Rectangle 4 selected, `align.left` without ids | Unchanged |

Native's own tests `al_behaviour_tests::{align_is_unavailable_for_a_child_in_an_auto_layout_flow, an_absolute_child_of_an_auto_layout_frame_still_aligns_to_it}` and `selection_cache_tests::the_align_buttons_are_off_for_a_layer_in_an_auto_layout_flow` check `can_align` and the panel's tip, which the port's unit and browser cases restate.
