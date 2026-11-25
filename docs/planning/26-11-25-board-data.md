# Roadmap row 16, item 1: the board data model

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `792e207` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-data.ts` (new: board items, shapes, stamps, connectors and their ends and paths, the board colours and page, the timer, votes, ballots and kept results, read and written as native's serde does; `remapBoardItem`); `src/engine/document.ts` (`Document` `kind`, `timer`, `vote`, `votes`, `voteHistory`; `LayerProperties.board`; `newDocument` for a board); `src/engine/file-format.ts` (reads and writes them; a native board no longer fails to open); `src/engine/editor.ts`, `src/engine/workspace.ts` (`file.newBoard`); `src/WorkspaceEditor.tsx` (New board); tests `tests/parity/board-document.test.ts`, fixture `tests/fixtures/native-board-document.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`doc/src/board.rs`, `facilitation.rs`, `lib.rs`, `node.rs`; `engine/src/cmd/file.rs`)

- **File kind**: `kind: "board"` on a board (left out on a design file). `file.newBoard {name?}` opens a board in a tab of its own, named "Untitled board" by default, its page the light board colour `#F4F3F0` whatever the theme.
- **Board items**: a layer's `board` says what it is for, tagged by `type`:
  - `sticky {author?}`, `shape {shape}` (one of 23 outlines), `label {connector}`;
  - `connector {from, to, routing, path?, branch?}`, where each end is `{node, side, at?}` or `{x, y}`, `path` is `{runs: {across, at}}` or `{bow: {x, y}}`, and `branch` marks a mind map's branch;
  - `stamp {stamp, author?, on?}`, `ink`, `table`, `mindNode`.

  Unknown fields or values are refused, as native's reader refuses them. Copies point a connector's ends and a label's connector at their copies (`remap`).
- **Facilitation**: `timer` (`{state: running, ends}` or `{state: paused, left}`), `vote` (`{perPerson, scope: {type: all|stickies|only, ids?}, ended, by?}`), `votes` (ballots by voter) and `vote_history` (ended votes' results, with names and when they ended), each left out when empty.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/board.rs::{FileKind, BoardItem, BoardShape, Stamp, Routing, Side, End, ConnectorPath, Connector, BOARD_COLORS, BOARD_PAGE, remap}` | `board-data.ts`; `document.ts` | Native observation; parity tests |
| `doc/src/facilitation.rs::{BoardTimer, Vote, VoteScope, Ballots, VoteRecord}`, `lib.rs` (`kind`, `timer`, `vote`, `votes`, `vote_history`), `node.rs` (`board`) | `board-data.ts`; `file-format.ts` | Native observation; parity tests |
| `engine/src/cmd/file.rs::new_file` (`file.newBoard`) | `document.ts` `newDocument`; `editor.ts`; `workspace.ts`; `WorkspaceEditor.tsx` | Parity test; browser case |

## Acceptance

- A board native saved (stickies, a shape, two connectors, a label, a stamp, ink, a table, a mind map, a paused timer, a running vote with a ballot, a kept result) opens in the port with every board item, the kind and the facilitation fields, and is written back with the same values as native wrote. Design files carry none of them. Unknown board fields are refused. `file.newBoard` makes a board on the board page.
- A browser case opens the native board, saves it, and makes a new board from the File menu. It failed before (the reader refused the file).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
