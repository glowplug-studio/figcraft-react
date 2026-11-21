# Native observations for the object snap distance (upstream a1980463, ebe0a8c2)

Data: [native-snap-distance.json](native-snap-distance.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `session` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Fifty-two recorded sessions, 320 steps. Each builds a 100 by 100 rectangle at the page origin, whose right edge is at 100, and one drag that ends with an edge or a point a given number of screen pixels to the right of it. `node.get` then reads the dragged layer. No step was refused.

Four kinds of drag, each in thirteen settings:

| Kind | The drag |
|---|---|
| move | A second rectangle, pressed at its centre and moved left |
| resize | The second rectangle's top-left transform handle, moved left |
| draw | The Rectangle tool, from (250, 300) to the point |
| vector point | The first point of an open path in vector edit mode, moved left |

| Setting | Gaps in screen pixels |
|---|---|
| 100% zoom, pixel grid off | 4.4, 4.5, 4.6, 4.9, 5.1 |
| 200% zoom, pixel grid off | 4.4, 4.5, 4.6, 4.9, 5.1 |
| 100% zoom, pixel grid on | 4, 5, 6 |

At 200% the page distance is half the screen distance, and the pointer events carry the zoom.

## What the observations showed

- With the pixel grid off, every kind of drag snaps to the neighbour's edge at a gap of 4.4 and of 4.5 screen pixels and stays where it was dragged at 4.6, 4.9 and 5.1, at both zooms. The distance is 4.5 screen pixels, inclusive.
- With the pixel grid on the pointer is rounded first: at 4 pixels the drag snaps, at 5 and 6 it does not.
- A first set recorded with the pixel grid on and fractional gaps could not show the distance, because 104.4 rounds to 104 and 104.6 to 105 before the snap. It was replaced by the sets above.

## Reproduction outside the port runtime

Run the `session` executable of the [Count handle provenance](native-count-handle.provenance.md) (source SHA-256 `0ff72dac2d596b96730fa0132e3a9a97176a5494762bdb2a4ae657f8d4a98f3e`; the earlier one of the [locked layers provenance](native-locked-layers.provenance.md) serves as well, since these sessions use none of the added steps) with `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.
