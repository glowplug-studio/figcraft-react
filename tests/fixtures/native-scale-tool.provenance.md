# Native observations for the Scale tool's drags and origin (upstream f0d39197)

Data: [native-scale-tool.json](native-scale-tool.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `session` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Nine recorded sessions, 140 steps, with 31 handle drags. Each selects one rectangle, chooses the Scale tool with `tool.scale`, sets the origin with `tool.scaleAnchor` where the session says so, and drags transform handles with `@drag`. `node.get` reads the layer after each drag, `tool.scaleAnchor {}` reads the origin, and `@undoDepth` the undo depth. No step was refused.

| Session | What it shows |
|---|---|
| the scale origin starts at the centre | The origin reads `c` before and after the tool is chosen, `tl` once set, and stays `tl` after returning to Move |
| a scale handle drag pivots on the opposite handle with the origin at c, tl, br, r and t (five sessions) | The same five drags of a 100 by 100 layer at (9000, 5000) give the same boxes whatever the origin |
| Alt scales from the centre whatever the origin | A corner drag keeps the opposite corner; with Alt a corner and an edge drag scale about the centre |
| a drag past the pivot flips and never collapses | A corner dragged through the opposite corner flips the layer; dragged onto it, the factor stops at 0.01 |
| scaling a stroked, rounded layer scales its stroke and radius | Stroke weight 2 and radius 8 become 4 and 16 at twice the size; undo restores them |

The five drags of the origin sessions: the bottom-right corner out to (9144, 5144), giving 144 by 144 at (9000, 5000); the right edge's middle out by 50, giving 150 by 150 at (9000, 4975); the top-left corner out by 50, giving 150 by 150 at (8950, 4950); the top edge's middle up by 50, giving 150 by 150 at (8975, 4950); and the left edge's middle in by 50, giving 50 by 50 at (9050, 5025). Each drag is one undo step.

The sessions restate `crates/engine/src/scale_tool_tests.rs` (`a_scale_handle_drag_pivots_on_the_opposite_handle_whatever_the_origin`, `the_scale_origin_starts_at_the_centre`, `the_anchor_is_read_back_and_alt_scales_from_the_centre`, `dragging_a_handle_scales_strokes_effects_and_radii_in_one_undo_step`), with three more origins and three more handles.

## Reproduction outside the port runtime

Run the `session` executable of the [locked layers provenance](native-locked-layers.provenance.md) (source SHA-256 `5132a01344693e83267eab19643ee50f6f1944e43e10c5fb186c61ba8b899fc8`, or the later one of the [Count handle provenance](native-count-handle.provenance.md); these sessions use none of the added steps) with `[{"name", "steps": [[step, params], ...]}]`, which is each case's `name` and `steps` in the fixture.
