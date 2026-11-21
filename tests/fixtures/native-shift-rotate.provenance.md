# Native observations for Shift while rotating (upstream a1ac22f1, da81d55a)

Data: [native-shift-rotate.json](native-shift-rotate.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `session` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Twenty recorded sessions, 149 steps. Each makes 120 by 80 rectangles, sets their rotation with `node.set`, selects them and makes one `@drag` that begins just outside a corner of the selection box, where the rotation handle is, and ends at the turned angle about the box's centre. `node.get` reads each layer before and after. `rotation` is the angle to the parent, counter-clockwise positive; a missing `rotation` is 0. No step was refused.

| Session | Rotation of each layer, before and after |
|---|---|
| a layer at 7 degrees turned by 37 with Shift | 7; 45 |
| a layer at 7 degrees turned by 37 | 7; 44 |
| a layer at 7 degrees turned by 3 with Shift | 7; 15 |
| a layer at -4.27 degrees turned by 2 with Shift | -4.27; 0 |
| a layer at 0 degrees turned by 20 with Shift | 0; 15 |
| a layer at 0 degrees turned by 7 with Shift | 0; 0 |
| a layer at 7 degrees turned by -10 with Shift | 7; 0 |
| a layer at 7 degrees turned by 100 with Shift | 7; 105 |
| a layer at 30 degrees turned by 10 with Shift | 30; 45 |
| a layer at 90 degrees turned by 5 with Shift | 90; 90 |
| a layer at 7 degrees turned by -3 with Shift | 7; 0 |
| two layers at 7 and 7 degrees turned by 37 with Shift | after: 45 and 45 |
| two layers at 7 and 7 degrees turned by 3 with Shift | after: 15 and 15 |
| two layers at 7 and 20 degrees turned by 37 with Shift | after: 37 and 50 |
| two layers at 7 and 20 degrees turned by 37 | after: 44 and 57 |
| two layers at 7 and 20 degrees turned by 3 with Shift | after: 7 and 20 |
| in a frame turned 10 degrees, a layer at 7 on the page turned by 40 with Shift | -3; 35 (45 on the page) |
| in a frame turned 10 degrees, a layer at 7 on the page turned by 6 with Shift | -3; 5 (15 on the page) |
| in a frame turned 10 degrees, a layer at 7 on the page turned by -10 with Shift | -3; -10 (0 on the page) |
| in a frame turned 10 degrees, a layer at 7 on the page turned by 6 | -3; 3 (13 on the page) |

The sessions restate the two tests of `crates/engine/src/transform_behaviour_tests.rs` (`shift_rotating_lands_on_multiples_of_15_not_steps_from_the_start` and `shift_rotating_inside_a_rotated_frame_lands_the_page_rotation_on_multiples_of_15`), with their starting rotations and turns. Added: starts of 0, 30 and 90 degrees, a turn of 100, turns back past zero, and two layers that share a rotation or do not.

## What the observations showed

- With Shift the rotation ends on a multiple of 15 degrees whatever it was: 7 turned by 37 is 45, by 3 is 15, by -3 or -10 is 0.
- Without Shift the turn is free: 7 turned by 37 is 44.
- Two layers that share a rotation behave as one: both end on the multiple. Two layers with different rotations have no shared rotation, so Shift steps the turn itself: a turn of 37 becomes 30 and a turn of 3 becomes none.
- Inside a frame turned 10 degrees the rotation on the page is what lands on the multiple: a layer at 7 on the page ends at 45, 15 and 0 on the page.

## Reproduction outside the port runtime

Run the `session` executable of the [locked layers provenance](native-locked-layers.provenance.md) (source SHA-256 `5132a01344693e83267eab19643ee50f6f1944e43e10c5fb186c61ba8b899fc8`, or the later one of the [Count handle provenance](native-count-handle.provenance.md); these sessions use none of the added steps) with `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.
