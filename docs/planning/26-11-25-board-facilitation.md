# Roadmap row 16, item 9: facilitation

## Execution checkpoint

- Phase: implemented and gated; recording follows the provider integrations.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `53fc7b0` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-facilitate.ts` (new: the timer, votes, results, kept results, badges); `src/engine/editor.ts` (the four commands, not undo steps; undo and redo leave facilitation as it is); `src/engine/canvas.ts` (vote badges); tests `tests/parity/board-facilitate.test.ts`, fixture `tests/fixtures/native-board-facilitate.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`engine/src/cmd/facilitate.rs`; `doc/src/facilitation.rs`; `ui-egui/src/canvas/board_facilitate.rs::badges`)

- **Timer**: `board.timer {action: start|pause|resume|add|stop, minutes?}`: one countdown per board, kept as its end time (or, paused, the time left), at most a day; start 5 minutes and add 1 by default, from 1 second to 1440 minutes. `board.timerState` answers `{state: off|running|paused|done, left, text (m:ss or h:mm:ss, seconds rounded up), ends}`.
- **Votes**: `board.vote {action: start|cast|retract|end|clear|delete, votes?, on?, ids?, id, index, voter?}`. One vote at a time, 1 to 99 votes each (3 by default), on all objects, stickies or the selection. A voter is `voter` (trimmed of control characters, 64 at most) or you. Votes on deleted objects stop counting. Ending keeps the results in the file with the names voters went by (the last 20); clearing takes them off the board; deleting removes kept ones (and clears them from the board when shown).
- **Results**: `board.voteResults {voter?}` answers your votes left and per object, the number of voters, and, once ended, every object's votes most first with ranks shared by ties and who voted; and every ended vote's results, newest first.
- **Undo**: none of these is an undo step, and undo and redo leave the timer, the vote and the kept results as they are.
- **Badges**: while a vote runs your votes, once it ends everyone's, as an 11-pixel brand circle with a white ring and the count at each object's top-right corner.
- **Refusals**: on design files ("this is for boards"), and native's messages for each action.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/facilitation.rs::{BoardTimer::left, VoteScope::{target, takes}, Vote::{counted, tally}}` | `board-facilitate.ts` | Restated native tests |
| `engine/src/cmd/facilitate.rs::{clock, timer_state, timer_after, timer_cmd, voter, vote_cmd, start_vote, change_ballot, end_vote, delete_results, mine, object_name, voters_of, sessions, voter_name, vote_json, ranked, badge, keep}` | `board-facilitate.ts`; `editor.ts` | Native observation; restated tests |
| `ui-egui/src/canvas/board_facilitate.rs::badges` | `board-facilitate.ts` `drawVoteBadges`; `canvas.ts` | Browser case |

## Deferred to item 10

Voting by clicking objects (native `vote_down`), the timer and vote bar, and the vote history window come with the board interface.

## Acceptance

- Native's timer, clock, tie and junk tests are restated, as is undo leaving facilitation alone.
- Native's run of timer and vote commands is replayed with native's receipts and refusals (times compared by what they mean), and the kept results match the file native saved.
- A browser case draws an ended vote's badge. It failed before (no badges).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
