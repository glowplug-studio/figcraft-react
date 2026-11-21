# Native observations for Escape (upstream a285fd29, 92cf9849)

Data: [native-escape.json](native-escape.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `session` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Nine recorded sessions, 152 steps, with 16 presses of Escape. Each builds one scene: frame 2 holding group 5 (rectangles 3 and 4) and rectangle 6, a top-level rectangle 7, and frame 8 holding rectangle 9. It then sets a selection or a mode with commands and presses Escape with `@escape` (`Session::escape`). `@selection` reads the selected ids, `@tool` the current tool and `@undoDepth` the undo depth. One step is refused on purpose: `vector.edit.state` after Escape has left vector editing.

| Session | What it shows |
|---|---|
| one Escape clears a layer in a group in a frame | The selection goes from the rectangle to nothing in one press; the undo depth does not change; a second press changes nothing |
| one Escape clears a top-level frame and a top-level layer | Nothing is selected after one press in each case |
| one Escape clears two layers in one group | Nothing is selected, not their group |
| one Escape clears layers in different parents and a nested layer with a top-level one | Nothing is selected in each case |
| with nothing selected Escape changes nothing | Selection, tool and undo depth are unchanged |
| with another tool Escape returns to Move first and keeps the selection | Rectangle tool: the first press gives Move with the layer still selected; the second clears the selection |
| with the Scale tool Escape returns to Move first | The same for the Scale tool |
| in vector edit mode Escape leaves editing first | The first press leaves vector editing with the layer selected and the Move tool; the second clears the selection |
| with the rotation origin being moved Escape ends that first | The first press keeps the selection; the second clears it |

The first four restate `crates/engine/src/selection_behaviour_tests.rs` as upstream changed and extended it. The other five observe the order of `crates/engine/src/canvas/tools/keys.rs::escape` for the states a recorded session can reach.

## Reproduction outside the port runtime

Build the `session` executable of the [Count handle provenance](native-count-handle.provenance.md) with one more addition to `src/session.rs`, which then has SHA-256 `d9e8a33e951dcfba0e72309b5cf375295ad56102ce1a08145ed7801744607bea`.

In the header comment, before the `@shapeHandles` line:

```rust
//!   "@tool" {}                                                     the current tool's id
```

In `step`, before the `"@shapeHandles"` arm:

```rust
        "@tool" => session.tool_info()["tool"].clone(),
```

Run it with `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.
