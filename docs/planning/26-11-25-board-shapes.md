# Roadmap row 16, item 2: stickies and shapes with text

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `d722e71`: [report](../reports/26-11-25-board-shapes.md), [matrix](../reports/26-11-25-board-shapes-parity.html), [provenance](../../tests/fixtures/native-board-shapes.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `1bd2c6d` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-shapes.ts` (new: the 23 outlines, their labels and text insets); `src/engine/board-commands.ts` (new: `board.sticky`, `board.shape`, `board.nextSticky` from a sticky, `board.setColor`, `board.setStyle`, the board tools' choices, board colours and their line shade, the refusals, `settleBoardText`); `src/engine/editor.ts` (dispatch, fonts prepared for board text, the text room settled after each edit, prototyping refused on boards); tests `tests/parity/board-shapes.test.ts`, fixture `tests/fixtures/native-board-shapes.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded. Item 3 follows in the row plan.
- Blockers: none.

## Native contract (`doc/src/board.rs` `BoardShape`; `engine/src/boards/board.rs`, `board/{items,edit,derived}.rs`)

- **Shapes**: `board.shape {shape, x, y, width?, height? (default 160, 1 to 100000), text?, color?, parent?}` makes a frame named after the shape, with no fill and a vertical auto layout centring its text inside the shape's text insets. The frame holds an absolutely placed outline (the shape's path at its size, filled with the colour, stroked 1.5 inside in its line shade, scaling with the frame) and a centred 16-point text filling the room.
- **Stickies**: `board.sticky {x, y, text?, color?, fontSize? (1 to 1000; default the tool's, 16), author? (a name, or false), parent?}` makes a 200 × 200 frame. It has the colour, 2-point corners, a soft shadow and a vertical auto layout (padding 16, gap 8, space between), hugging its height from at least 200. It holds the note (16 points by default) and, when the author is known, a 10-point author line named Author.
- **Next sticky**: `board.nextSticky {id?, side?, edit?}` puts a sticky of the same colour beside the given, edited or selected sticky, 24 apart. From a shape it adds the next shape joined by a connector (item 4).
- **Colour and style**: `board.setColor` fills stickies, fills shapes' outlines and strokes them in the line shade; connectors and ink take the line. `board.setStyle` changes a shape's outline and its text room, the text size of stickies, shapes, labels and mind nodes (a sticky's is kept for new ones), and connectors' routing and caps.
- **Settling**: a resized shape's text room follows its new size.
- **Refusals**: board commands on design files ("this is for boards: make one with File ▸ New board"); prototyping and Dev Mode on boards; native's parameter messages.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/board.rs::BoardShape::{names, from_id, path, text_insets}`, `star_points`, `database`, `document`, `with_lines` | `board-shapes.ts` | Native observation (46 outlines) |
| `engine/src/boards/board/items.rs::{add_text, make_sticky, sticky_cmd, make_shape, shape_cmd, shape_padding, next_sticky, text_of, owner_of_text}` | `board-commands.ts` | Native observation; parity tests |
| `engine/src/boards/board/edit.rs::{set_color, set_style, Restyle, reshape, resize_text}`, `board.rs::{color_param, line_shade, parent_of, require, refuse_on_board, BoardTool}` | `board-commands.ts`; `editor.ts` | Native observation; parity tests |
| `engine/src/boards/board/derived.rs::settle_text` (shapes) | `board-commands.ts` `settleBoardText`; `editor.ts` | Parity test |

## Acceptance

- Native's run of every shape at two sizes and two stickies is replayed by the port's commands with the same receipts, and every layer matches (text heights left out: native's headless engine measures none). The outlines match native's networks to 1e-9.
- Native's refusals are reproduced word for word.
- Restyling, the remembered text size and the resized shape's text room are covered.
- A browser case draws a sticky and a diamond made by the commands. It failed before (there were no board commands).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
