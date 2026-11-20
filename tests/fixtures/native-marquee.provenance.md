# Native observations for marquee selection (upstream cb526214, 604c7846)

Data: [native-marquee.json](native-marquee.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `session` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Twenty-one recorded sessions, 472 steps, with 51 marquee drags. Each session builds a scene with commands, then repeats: `select.none`, one `@drag` (a press, a move and a release through `Session::pointer`, with Shift or Ctrl/Cmd where given), and `@selection`, the selected layer ids. No step was refused.

Seventeen sessions use the scene of `crates/engine/src/marquee_behaviour_tests.rs`: frame 2 (0,0 300×200) holding rectangles 3 (20,20) and 4 (220,120), both 60×60; ellipse 5 (500,0 200×200); rectangle 6 (900,0 100×100); rectangle 7 (0,400 200×100) and ellipse 8 (500,400 200×100), both turned 45 degrees; the empty frame 9 (0,700 200×150); group 12 of rectangles 10 and 11; section 13 (600,700 300×200) holding rectangle 14. Two sessions use that file's smaller scenes, and the last two build their own.

| Session | Selections, in order |
|---|---|
| a partly covered frame gives the layers it touches | [3] |
| an enclosed frame is selected itself | [2] |
| an empty frame is selected on touch | [9] |
| a group is selected whole on touch | [12] |
| a partly covered section gives the layers it touches | [14] |
| an enclosed section is selected itself | [13] |
| an unrotated shape is touched by its box | [5]; [6] |
| a rotated rectangle is touched by its outline | []; [7] |
| a rotated ellipse is not touched by its axis-aligned box | []; [8] |
| a rotated ellipse is not touched through the corner of its turned box | []; []; [8] |
| a drag from inside a frame selects only what it touches | []; []; [5]; [4] |
| selecting a frame whole keeps the marquee at the top level | [2, 7, 9] |
| a marquee enclosing an empty frame takes a partly covered frame whole | [2, 4] |
| a drag from inside a frame takes it whole when it takes another top-level frame | [2, 5]; [2, 5]; [2, 5, 6]; [6] |
| a Ctrl or Cmd marquee selects the innermost layers | [3]; [3, 4]; [10]; [14]; [9] |
| Shift adds to and takes from the selection | [6, 3]; [6]; [] |
| hidden and locked layers are not touched | []; []; [2] |
| a marquee begun on a frame's empty area takes the layers in it that it touches | []; [3, 4] |
| a frame whose far edge is on the marquee's edge is not enclosed | [3, 4]; [2]; [3, 4] |
| components and instances are selected only when enclosed | []; [2]; []; [4]; [3] |
| a frame holding a group and a rectangle, with a rectangle outside | [5, 7]; [3, 4, 7]; [3, 4, 6]; [2]; [5] |

Thirteen restate the thirteen tests of `marquee_behaviour_tests.rs` drag for drag. Added: an enclosed section, a Ctrl/Cmd marquee, Shift, hidden and locked layers, a marquee begun on a frame's empty area, a frame's far edge exactly on the marquee's edge, components and instances, and the scene of the port's earlier marquee test (the last session).

## What the observations showed

- A marquee from outside over part of a frame selects the layers in the frame that it touches. Covering the frame selects the frame. An empty frame and a group are selected on touch.
- A frame whose far edge is exactly on the marquee's far edge is not covered: the marquee has to pass it.
- A component and an instance are selected only when covered; a plain marquee over part of one selects nothing, and a Ctrl/Cmd marquee reaches inside.
- A drag begun inside a frame selects the layers it touches inside and outside it, never the frame, unless it also takes another top-level frame whole. Then both frames are selected and nothing inside them.
- Once any frame is taken whole, a partly covered frame comes whole too.
- A rotated rectangle or ellipse is touched by its outline: the corner of its page box, and the corner of the turned box of an ellipse, select nothing.
- Hidden and locked layers are never selected.

## Corrections made while observing

- A Shift drag was first recorded starting 14 units from a selected layer's corner. Native turned the layer with the rotation handle there, so the selection did not change. The drag now starts well away.
- A drag was first recorded starting on a rectangle inside a frame. That is a press on a layer, which selects and moves it, not a marquee. It was removed.

## Reproduction outside the port runtime

Run the `session` executable of the [locked layers provenance](native-locked-layers.provenance.md) (source SHA-256 `5132a01344693e83267eab19643ee50f6f1944e43e10c5fb186c61ba8b899fc8`) with `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.
