# Roadmap row 16, item 1: the board data model

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `1bd2c6d`. **This bounded item passes. Items 2 to 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Before this item a board saved by native did not open in the port: the reader refused any file kind, timer, vote or board item. The port now reads and writes native's board data ([`board-data.ts`](../../src/engine/board-data.ts), [`file-format.ts`](../../src/engine/file-format.ts), [`document.ts`](../../src/engine/document.ts)):

- **The file's kind.** `kind: "board"` marks a board, and design files leave it out.
- **Board items.** Each layer can say what it is for: a sticky with its author, a shape with its outline, a connector, a connector's label, a stamp, ink, a table or a mind map node.
  - A connector keeps its two ends (a layer and its side, or a free point), its routing, a path reshaped by hand and whether it is a mind map's branch.
  - A stamp keeps the stamp, who placed it and the object it sits on.
- **Facilitation.** The board keeps its timer, its vote, the vote's ballots and the results of ended votes.

Fields or values native would not read are refused. A copied connector's ends and a copied label's connector point at their copies (`remapBoardItem`).

`file.newBoard` opens a board in a tab of its own, named "Untitled board", on the light board page; the workspace's File menu and home offer New board.

## Evidence

| Case | Content | Result |
|---|---|---|
| Native observation | A board native saved: a sticky, a shape, two connectors (one reshaped, attached by hand), a label, a stamp, ink, a table, a mind map, a paused timer, a running vote with a ballot and a kept result ([provenance](../../tests/fixtures/native-board-document.provenance.md)) | Opened with every item and field, and written back with the same values |
| Parity tests | The refusals, design files without board fields, copies remapped, `file.newBoard` on the board page | Pass |
| Browser | The native board opened (its stickies and connectors in the layer list), saved, and New board from the File menu | Pass; failed before |

## Recorded differences

- None in what is read or written. Making and editing board objects comes with items 2 to 8, facilitation with item 9 and the board interface with item 10; until then a board opens, shows and saves like any file.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/board.rs` (`FileKind`, `BoardItem`, `BoardShape`, `Stamp`, `Routing`, `Side`, `End`, `ConnectorPath`, `Connector`, `BOARD_COLORS`, `BOARD_PAGE`, `remap`) | `board-data.ts`, `document.ts` |
| `crates/doc/src/facilitation.rs`, `lib.rs` (`kind`, `timer`, `vote`, `votes`, `vote_history`), `node.rs` (`board`) | `board-data.ts`, `file-format.ts` |
| `crates/engine/src/cmd/file.rs::new_file` (`file.newBoard`) | `document.ts`, `editor.ts`, `workspace.ts`, `WorkspaceEditor.tsx` |

[Property matrix](26-11-25-board-data-parity.html) · [Plan](../planning/26-11-25-board-data.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-document.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `1bd2c6d`, native reference `bad07e44` |
| Failing fixtures first | The native board failed to open before |
| Full pure suite | 5,689 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 441 cumulative Chromium cases passed in one 17.6-minute run at `1bd2c6d` with zero skips, retries, flakes or suite errors: the 440 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 15.72 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,589 nodes/40,750 edges at `1bd2c6d`; native 28,939/92,127 at `bad07e44`; combined 38,528/131,632. `readBoardItem`, `wireBoardItem`, `remapBoardItem`, `readTimer` and `wireBoardDocument` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-document.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "native board opens" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 2 to 10.
