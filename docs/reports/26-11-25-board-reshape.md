# Roadmap row 16, item 4: reshaped connectors and joined shapes

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `1f3d73e`. **This bounded item passes. Items 5 to 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Connectors can now be reshaped and objects joined, as native does both ([`board-commands.ts`](../../src/engine/board-commands.ts)):

- **board.reshape**:
  - Elbow: moves an elbow's run, and a first or last run gains a run to stay on its end.
  - Curved: moves a curve's middle, which keeps its bow as the ends move.
  - The reshaped path travels with what the connector joins, and its ends keep the sides they left by.
  - A new style or a reattached end goes back to routing itself.
- **board.addConnected** makes the next sticky or shape of the same kind, size and colour beside one, or where it is dropped, joined by a connector; `board.nextSticky` from a shape does the same.

## Evidence

| Case | Content | Result |
|---|---|---|
| Native observation | Elbow and curved connectors reshaped, refusals, joined shapes and stickies on each side and at a dropped point, `nextSticky` from a shape, a restyle ([provenance](../../tests/fixtures/native-board-reshape.provenance.md)) | Native's receipts and layers |
| Restated native tests | `board_reshape_tests.rs`: a moved run travelling with its objects and undone, sides kept, extra runs, a lone run, a curve's bow, refusals, the run limit, a new style or end | Pass |
| Browser | A reshaped elbow and a joined shape drawn on the board | Pass, by pixels; failed before |

## Recorded differences

- None in what the commands do. The canvas handles that drive them (path handles, the "+" beside an object) come with the board interface (item 10).

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/boards/board/reshape.rs` (`pinned`, `moved`, `reshape`), `crates/doc/src/board_route.rs` (`reshaped`, `attached_sides`) | `board-commands.ts`, `board-route.ts` |
| `crates/engine/src/boards/board/items.rs` (`connected_place`, `add_connected`, `drop_point`, `next_sticky`) | `board-commands.ts` |

[Property matrix](26-11-25-board-reshape-parity.html) · [Plan](../planning/26-11-25-board-reshape.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-reshape.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `1f3d73e`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,707 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 444 cumulative Chromium cases passed in one 16.9-minute run at `1f3d73e` with zero skips, retries, flakes or suite errors: the 443 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 12.97 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,728 nodes/41,248 edges at `1f3d73e`; native 28,939/92,127 at `bad07e44`; combined 38,667/132,118. `connectedPlace`, `executeBoard`, `reshaped`, `attachedSides` and `routeAlong` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-reshape.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "reshaped connector" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 5 to 10.
