# Roadmap row 16, item 7: grids and templates

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `a4a4e53`. **This bounded item passes. Items 8 to 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

- **Templates.** `board.template` places one of native's five templates (retrospective, brainstorm, weekly planner, flow chart, kanban) as ordinary board objects. The objects are made by running the board commands, in one undo step ([`board-templates.ts`](../../src/engine/board-templates.ts)). `board.templates` lists them.
- **The board grid.** `board.grid` sets and reads the board canvas's grid (dots, lines, graph or none, with its spacing, major lines, size and contrast) within native's ranges, kept with the session ([`board-grid.ts`](../../src/engine/board-grid.ts)).

## Evidence

| Case | Content | Result |
|---|---|---|
| Native observation | Each of the five templates placed on a new board; the list, a name in another case, the refusals and the grid's answers ([provenance](../../tests/fixtures/native-board-templates.provenance.md)) | Native's receipts and the same layers (text heights and what follows from them left out); the grid's answers reproduced |
| Browser | The retrospective's tinted section and green sticky | Pass, by pixels; failed before |

## Recorded differences

- **The grid on the canvas.** Drawing the grid behind the board, and keeping it with the saved preferences across sessions, come with the board interface (item 10); the command and its ranges are here.
- **Text heights.** As before, native's headless engine measures no text; sticky heights, shapes' text centring and label sizes follow the port's measured text.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/boards/board_templates.rs` | `board-templates.ts`, `board-commands.ts`, `editor.ts` |
| `crates/engine/src/boards/board_grid.rs` | `board-grid.ts`, `editor.ts` |

[Property matrix](26-11-25-board-templates-parity.html) · [Plan](../planning/26-11-25-board-templates.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-templates.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `a4a4e53`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,718 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 447 cumulative Chromium cases passed in one 16.8-minute run at `a4a4e53` with zero skips, retries, flakes or suite errors: the 446 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 12.97 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,794 nodes/41,472 edges at `a4a4e53`; native 28,939/92,127 at `bad07e44`; combined 38,733/132,338. `buildTemplate`, `findTemplate`, `boardGridCommand`, `templateList` and `executeBoard` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-templates.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "board template places" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 8 to 10.
