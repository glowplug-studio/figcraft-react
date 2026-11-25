# Roadmap row 16, item 9: facilitation

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `51c09e0`. **This bounded item passes. Item 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Boards run sessions as native does ([`board-facilitate.ts`](../../src/engine/board-facilitate.ts)):

- **Timer.** `board.timer` starts, pauses, resumes, adds to and stops one countdown per board, kept as its end time so every viewer counts it from their own clock; `board.timerState` reads it.
- **Votes.** `board.vote` runs one vote at a time: votes per person, on all objects, stickies or the selection; casting and retracting; ending, which keeps the results with the names voters went by (the last 20); clearing and deleting kept results. `board.voteResults` answers your votes and, once a vote ends, every object's votes most first with ranks shared by ties and who voted.
- **Undo.** None of these is an undo step, and undo and redo leave the timer, the vote and the kept results as they are ([`editor.ts`](../../src/engine/editor.ts)).
- **Badges.** While a vote runs your votes, once it ends everyone's, show as numbered brand badges at objects' top-right corners ([`canvas.ts`](../../src/engine/canvas.ts)).

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `facilitate_tests.rs`: the timer from its end time, clocks, undo leaving facilitation alone, ties, junk, boards only | Pass |
| Native observation | The timer and its refusals; votes cast, retracted, ended, cleared; a vote on the selection; kept results deleted ([provenance](../../tests/fixtures/native-board-facilitate.provenance.md)) | Native's receipts and refusals; the kept results as in native's file |
| Browser | An ended vote's badge on a sticky's corner | Pass, by pixels; failed before |

## Recorded differences

- **Times.** `ends` and `ended` depend on the clock; they are compared by what they mean (the time left).
- **`select.set`.** The port answers with ids as text where native answers with numbers. It is on the deferred queue for the final audit.
- **On the canvas.** Voting by clicking objects, the timer and vote bar and the vote history window come with the board interface (item 10).

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/facilitation.rs` | `board-facilitate.ts` |
| `crates/engine/src/cmd/facilitate.rs` | `board-facilitate.ts`, `editor.ts` |
| `crates/ui-egui/src/canvas/board_facilitate.rs::badges` | `board-facilitate.ts` `drawVoteBadges`, `canvas.ts` |

[Property matrix](26-11-25-board-facilitation-parity.html) · [Plan](../planning/26-11-25-board-facilitation.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-facilitate.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `51c09e0`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before; the commands were unsupported |
| Full pure suite | 5,731 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 449 cumulative Chromium cases passed in one 16.9-minute run at `51c09e0` with zero skips, retries, flakes or suite errors: the 448 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.24 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,900 nodes/41,809 edges at `51c09e0`; native 28,939/92,127 at `bad07e44`; combined 38,839/132,669. `executeFacilitate`, `timerAfter`, `voteJson`, `keepFacilitation` and `drawVoteBadges` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-facilitate.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "ended vote shows" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 item 10, the board interface.
