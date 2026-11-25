# Roadmap row 16, item 8: mind maps

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `53fc7b0`. **This bounded item passes. Items 9 and 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Boards make mind maps as native does ([`board-mindmap.ts`](../../src/engine/board-mindmap.ts), [`board-commands.ts`](../../src/engine/board-commands.ts)):

- **board.mindMap** makes a first node with children on curved branches.
- **board.mindMapAdd** adds a child below the others or a sibling right after one.
- **Layout.** After every edit the touched maps lay themselves out by native's rule: columns 88 apart past the widest sibling, siblings 48 apart centred on their parent, left children mirrored. A deleted node takes its branches and leaves its children where they are.

Writing the run found that `edit.delete` reported deleted ids as text where native reports numbers ([`structure.ts`](../../src/engine/structure.ts)); it now answers as native does.

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `board_mindmap_tests.rs`: three children, a taller node, grandchildren past the widest sibling, left children, a fixed point with ties and junk | Pass |
| Native observation | A map, a child and a grandchild, a sibling, the refusals, a second map, a deleted node ([provenance](../../tests/fixtures/native-board-mindmap.provenance.md)) | Native's receipts, nodes, text styles, branches and tree; the port's map laid out by native's rule |
| Browser | A map's branch drawn where the layout puts it | Pass, by pixels; failed before |

## Recorded differences

- **Node widths.** Native's headless engine measures no text, so its observed nodes are their least width; the port's nodes hug their measured text as the desktop app's do. Positions are therefore checked against native's layout rule rather than native's numbers.
- **Editing on the canvas.** Typing in a node and the canvas's add buttons come with the board interface (item 10).

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/board_mindmap.rs` | `board-mindmap.ts` |
| `crates/engine/src/boards/board/mindmap.rs` | `board-commands.ts`, `board-mindmap.ts`, `editor.ts` |

[Property matrix](26-11-25-board-mindmap-parity.html) · [Plan](../planning/26-11-25-board-mindmap.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-mindmap.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `53fc7b0`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before; the delete receipt reported text ids |
| Full pure suite | 5,724 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 448 cumulative Chromium cases passed in one 16.9-minute run at `53fc7b0` with zero skips, retries, flakes or suite errors: the 447 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.24 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,834 nodes/41,615 edges at `53fc7b0`; native 28,939/92,127 at `bad07e44`; combined 38,773/132,476. `mindLayout`, `settleMindMaps`, `branchesOf`, `mapChildren` and `executeBoard` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-mindmap.test.ts tests/parity/component-containers.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "mind map lays" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 9 and 10.
