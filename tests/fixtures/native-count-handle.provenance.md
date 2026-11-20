# Native observations for the Count handle of polygons and stars (upstream 89d8b50e, d773ab29)

Data: [native-count-handle.json](native-count-handle.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `session` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Ten recorded sessions, 145 steps, with 34 handle drags. A step is a command through `Session::execute`, `@selection`, `@undoDepth`, or one of two steps added to the oracle for this item:

- `@shapeHandles` gives the selected shape's handles as the canvas shows them: `[{handle, at: [x, y]}]`, from `Session::tool_info`.
- `@dragHandle {kind, corner?, to}` presses on that handle where native shows it, moves to `to`, reads the readout while the handle is held, and releases. It gives `{from, hint}`: the handle's position before the drag, and the readout's handle, value and position.

All shapes are 200 by 200 at the page origin unless the session says otherwise, so the centre is (100, 100).

| Session | Handle drags | Point counts read, in order |
|---|---|---|
| a polygon has a count handle on its first vertex clockwise from the top | 0 | 5 |
| dragging the count handle sets the count by the angle about the centre | 8 | 5, 4, 8, 3, 60, 60, 3, 4, 60 |
| dragging a star's count handle sets its points and keeps its ratio | 4 | 5, 4, 8, 3, 60 |
| a count drag is one undo step | 1 | 5, 8, 5 |
| a rotated polygon's count angle is measured in its own frame | 3 | 5, 3, 3, 6 |
| a stretched polygon measures the angle on the circle its box maps from | 3 | 4, 12, 60 |
| count boundaries | 10 | 5, 4, 3, 60, 59, 60, 3, 3, 3, 3, 3 |
| the count handle among the radius and ratio handles | 3 | 5, 5, 5, 6 |
| small, locked and several selected layers show no count handle | 0 | |
| the readout while the handle is held | 2 | 5, 12 |

The first five restate the five Count tests of `crates/engine/src/shape_handles_tests.rs`. The rotated session uses three page points of its own in place of that test's computed ones. Added: a stretched polygon, the boundaries of the rounding, the handle beside the radius and ratio handles, the layers that show no handles, and the readout.

## What the observations showed

- The handles of a polygon are its radius handle, then the Count handle; of a star its radius handle, its ratio handle, then the Count handle.
- The Count handle is on the point itself: for five points at (195.106, 69.098), 72 degrees clockwise from the top. It is not inset.
- A drag to 90 degrees gives 4 points, 45 gives 8, 120 gives 3, half a degree and zero give 60, 200 gives 3. The distance from the centre does not matter. A pointer on the centre gives 60.
- The rounding is round(360 / angle): 102.8 degrees gives 4 and 102.9 gives 3; 6.0 gives 60, 6.1 gives 59. Angles of 144 degrees and beyond, a full half turn, and an angle just short of a full turn all give 3.
- A star keeps its ratio of 0.38 through count drags.
- A rotated polygon measures the angle from its own top, and a stretched one on the circle its box maps from.
- A drag is one undo step.
- While the handle is held the readout gives the count and sits on the handle's new position.
- A layer smaller than 48 on a side, a locked layer, a hidden layer and several selected layers show no handles.

## Reproduction outside the port runtime

Build the `session` executable of the [locked layers provenance](native-locked-layers.provenance.md) with two additions to `src/session.rs`, which then has SHA-256 `0ff72dac2d596b96730fa0132e3a9a97176a5494762bdb2a4ae657f8d4a98f3e`. With the additions the executable reproduces the earlier marquee sessions byte for byte.

In the header comment, after the `@undoDepth` line:

```rust
//!   "@shapeHandles" {}                                             the selected shape's handles: [{handle, at: [x, y]}]
//!   "@dragHandle" {kind, corner?, to: [x, y], zoom?, alt?}          press on that shape handle, move, release; gives
//!                                                                  {from, hint}: where it was and the readout while held
```

In `step`, after the `"@undoDepth"` arm:

```rust
        "@shapeHandles" => session.tool_info()["shapeHandles"].clone(),
        "@dragHandle" => {
            let handles = session.tool_info()["shapeHandles"].clone();
            let wanted = handles
                .as_array()
                .and_then(|a| a.iter().find(|h| h["handle"]["kind"] == p["kind"] && (p["corner"].is_null() || h["handle"]["corner"] == p["corner"])))
                .ok_or("no such shape handle")?
                .clone();
            let (x0, y0, x1, y1) = (num(&wanted["at"][0])?, num(&wanted["at"][1])?, num(&p["to"][0])?, num(&p["to"][1])?);
            session.pointer(&event(PointerKind::Down, x0, y0, p)).map_err(err)?;
            session.pointer(&event(PointerKind::Move, x1, y1, p)).map_err(err)?;
            let hint = session.tool_info()["overlay"]["shape"].clone();
            session.pointer(&event(PointerKind::Up, x1, y1, p)).map_err(err)?;
            json!({"from": wanted["at"], "hint": hint})
        }
```

Run it with `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.
