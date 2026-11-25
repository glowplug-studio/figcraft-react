# Roadmap row 16, item 5: stamps and ink

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `3a72456`. **This bounded item passes. Items 6 to 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Boards take stamps and ink as native's do ([`board-commands.ts`](../../src/engine/board-commands.ts)):

- **board.stamp** places one of the six stamps (thumbs up, heart, plus one, star, question, check): a round badge in its colour with its white mark, sitting on the object it lands on.
- **board.ink** draws a marker stroke, or a wide see-through highlighter stroke.

After every edit a stamp moves with the object it sits on. A stamp moved by itself sits on whatever is under it now; one whose object is deleted sits on nothing and stays.

## Evidence

| Case | Content | Result |
|---|---|---|
| Native observation | Six stamps on a sticky and one on nothing, a marker and a highlighter stroke, the refusals, the sticky moved ([provenance](../../tests/fixtures/native-board-stamps.provenance.md)) | Native's receipts and layers; the stamps carried as native carries them |
| Parity test | A stamp moved onto another sticky sits on it, and on nothing once that sticky is deleted | Pass |
| Browser | A heart stamp and a blue stroke drawn; the sticky moved and its stamp with it | Pass, by pixels; failed before |

## Recorded differences

- None in what the commands do. The stamp, marker, highlighter and eraser tools on the canvas come with the board interface (item 10).

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/board.rs` (`Stamp`, `STAMP_SIZE`), `crates/engine/src/boards/board/items.rs` (`stamp_cmd`, `ink_cmd`), `board.rs` (`MARKER`, `HIGHLIGHTER`) | `board-commands.ts` |
| `crates/engine/src/boards/board/derived.rs` (`settle_stamps`, `stamp_target`, `carry`) | `board-commands.ts`, `editor.ts` |

[Property matrix](26-11-25-board-stamps-parity.html) · [Plan](../planning/26-11-25-board-stamps.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-stamps.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `3a72456`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,709 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 445 cumulative Chromium cases passed in one 16.8-minute run at `3a72456` with zero skips, retries, flakes or suite errors: the 444 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 12.97 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,742 nodes/41,299 edges at `3a72456`; native 28,939/92,127 at `bad07e44`; combined 38,681/132,168. `stampTarget`, `settleBoardStamps`, `stampColour`, `executeBoard` and `settleBoardRoutes` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-stamps.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "stamps sit" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 6 to 10.
