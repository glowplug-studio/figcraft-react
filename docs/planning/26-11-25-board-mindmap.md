# Roadmap row 16, item 8: mind maps

## Execution checkpoint

- Phase: implemented and gated; recording follows the provider integrations.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `a4a4e53` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-mindmap.ts` (new: `mindLayout`, branches and the tree, `settleMindMaps`); `src/engine/board-commands.ts` (`board.mindMap`, `board.mindMapAdd`, mind map nodes and branches); `src/engine/editor.ts` (maps settled after each edit, before connectors follow; fonts prepared); `src/engine/structure.ts` (`edit.delete` reports ids as numbers, as native does); tests `tests/parity/board-mindmap.test.ts`, `tests/parity/component-containers.test.ts` (the delete receipts), fixture `tests/fixtures/native-board-mindmap.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`doc/src/board_mindmap.rs`; `engine/src/boards/board/mindmap.rs`)

- **Nodes and branches**: a node is a frame named Mind map node hugging one text with no padding, at least 8 wide and a line tall. The first node is 24-point Bold, the others 16-point Medium, at 150% line height and -1.9% or -1.1% letter spacing. A branch is a curved connector from the parent to the child, marked as a branch, stroked 4 in `#757575` with round caps, leaving the parent's right side (left side on the left of the map).
- **board.mindMap** `{x?, y?, text?, children?, parent?, edit?}`: a first node (Topic) with children (Idea 1 to 3 by default, at most 20), centred on the view in its parent when no place is given, within a billion of the origin.
- **board.mindMapAdd** `{id?, relation?, text?, edit?}`: a child below the node's other children, or a sibling right after it. The first node has no siblings.
- **Layout**: children stand 88 past their parent's column, past the widest of their siblings. Siblings stack 48 apart, centred on their parent, in the order of their middles and then id; left children mirror right ones. Depth stops at 64 and size at 2,000 nodes. After an edit the maps it touched are laid out again from their first nodes. A branch that no longer joins two layers of its page is removed, so a deleted node's children float free.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/board_mindmap.rs::mind_layout` and its constants | `board-mindmap.ts` `mindLayout` | Restated native tests |
| `engine/src/boards/board/mindmap.rs::{make_node, branch, branches, arriving, map_children, map_side, mind_map_cmd, mind_map_add, prune_branches, map_boxes, shift, settle_mind_maps}` | `board-commands.ts`; `board-mindmap.ts`; `editor.ts` | Native observation; browser case |

## Acceptance

- Native's five layout tests are restated.
- Native's run is replayed with native's receipts, nodes, text styles, branches and tree: a map, children and siblings added, the refusals, a second map, and a deleted node. The port's map is laid out by native's rule from its measured node boxes.
- `edit.delete` reports deleted ids as numbers, as native does.
- A browser case draws a branch where the map puts it. It failed before (no mind maps).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
