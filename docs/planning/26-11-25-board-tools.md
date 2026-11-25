# Roadmap row 16, item 10a: board tools and picking

## Execution checkpoint

- Phase: implemented and gated; recording follows the provider integrations.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `f59d6bd` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-commands.ts` (the board tool commands and what each remembers; unknown parameters refused with `id` and `ids` always taken); `src/engine/board-tool-interaction.ts` (new: presses that place a sticky, shape or stamp, the eraser, double-clicks that type in a board object or a new connector label); `src/engine/pencil-interaction.ts` (marker and highlighter strokes); `src/engine/selection.ts` (a board object picked whole); `src/engine/editor.ts` (the tool commands, answering `{tool}` as native for every tool; the eraser preview); `src/engine/canvas.ts`, `src/engine/canvas-text-input.ts` (presses, double-clicks, typing in a placed sticky); `src/engine/board-facilitate.ts` (unknown parameters refused); `src/BoardToolbar.tsx` (new: the board toolbar, its flyouts and templates picker), `src/Editor.tsx` (the toolbar on boards; the board tools' keys); tests `tests/parity/board-tools.test.ts`, fixture `tests/fixtures/native-board-tools.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`engine/src/boards/board.rs` tool specs; `boards/board/tools.rs`; `doc/src/geometry.rs::select_target`; `ui-egui/src/toolbar.rs` `BOARD_GROUPS`; `canvas/board_bar.rs::choices`; `widgets/board_picker.rs`; `keymap.rs`)

- **Tools**: `tool.sticky {color?}`, `tool.shape {shape?}`, `tool.connector {style?}`, `tool.marker {color?}`, `tool.highlighter {color?}`, `tool.eraser`, `tool.stamp {stamp?}` choose the tool and keep the choice for the next press; boards only; every tool answers `{tool}`. Keys Q, B, X, M, U, E and W on boards.
- **Presses**: a sticky (200 square) or shape (160 square) is placed centred on the press, then Move comes back; a placed sticky is typed in with its text selected; stamps go on one after another. Marker and highlighter strokes run from the press to the release, fitted as the pencil fits, on the page, the selection kept. The eraser removes the strokes within 8 screen pixels until it is let go, as one undo step.
- **Picking**: a sticky, shape, label, stamp, table or mind map node is picked whole, unless a layer inside it is selected.
- **Double-clicks**: with Move, a board object's text is typed in, all selected; a connector gets a label, "Label", to type in.
- **Toolbar**: Move; Marker, Highlighter, Eraser; Sticky note with its colours; Shapes with the 23 shapes; Connector; Text; Section; Stamp with the six stamps; Comment; Templates (the five templates and a table).
- **Unknown parameters** (#1413): a name a command doesn't take is refused, naming what it takes; `id` and `ids` are always taken.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `boards/board.rs` tool specs, `shape_of`, `stamp_of`, `routing_of`, `color_param`; `cmd/view.rs::tool` | `board-commands.ts` `boardToolCommand`; `editor.ts` | Native observation |
| `boards/board/tools.rs::{board_down, board_placed, erase_at, erase_up, ink_finish, board_double_click}`; `canvas/tools/pen.rs::pencil_finish` | `board-tool-interaction.ts`; `pencil-interaction.ts`; `canvas.ts` | Restated native tests; browser case |
| `doc/src/geometry.rs::select_target`, `BoardItem::is_atom` | `selection.ts` `targetForLeaf` | Restated native test |
| `ui-egui/src/toolbar.rs` `BOARD_GROUPS`, `canvas/board_bar.rs::choices`, `widgets/board_picker.rs`, `keymap.rs` | `BoardToolbar.tsx`; `Editor.tsx` | Browser case |
| `cmd/mod.rs` unknown parameters (`unknown_params_tests.rs`) | `board-commands.ts` `refuseUnknown`; `board-facilitate.ts` | Native observation |

## Deferred

- Dragging a connector out with the connector tool (10b); the template cards' pictures (drawn with the board bar, 10c).
- A board tool left on when a design file comes to the front presses as Move in native; in the port each file keeps its own tool, so it cannot arise, and the press still falls back to Move.

## Acceptance

- Native's runs of the tool commands and unknown parameters are replayed with native's replies and refusals.
- Native's tool tests are restated: a shape placed and Move back, stamps one after another, a sticky typed in and its own undo step, an ink stroke from press to release, erasing in one step, picking whole, double-clicks on a shape and a connector.
- A browser case chooses a sticky colour from the toolbar, places a sticky, types in it and sees it blue. It failed before (no board toolbar).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
