# Roadmap row 16, item 3: connectors

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `9b457e5`. **This bounded item passes. Items 4 to 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Connectors join board objects as native's do ([`board-route.ts`](../../src/engine/board-route.ts), [`board-commands.ts`](../../src/engine/board-commands.ts)):

- **Routes.** A connector runs from just outside the side of each object facing the other end, or the side it names, or a spot placed by hand.
  - Straight runs end to end; curved is one curve leaving along the sides.
  - Elbow runs in right angles and goes round the objects it joins when the short way would cross them.
- **board.connector** makes the connector with its caps, style and optional label.
- **board.reattach** moves one end to another object or off into the page.
- **board.label** adds, changes or removes the label at the connector's middle.

After every edit, connectors follow the objects they join. An end whose object is deleted stays where it was, as a point; a connector moved on its own takes its free ends along. Labels follow their connectors and go with them.

## Evidence

| Case | Content | Result |
|---|---|---|
| Native observation | Three shapes, six connectors of every style, a label, a reattached end, a moved shape, a restyle and recolour, then a deleted shape ([provenance](../../tests/fixtures/native-board-connectors.provenance.md)) | The port's commands give native's receipts; every connector's item, network, box and stroke match, and every label sits at the same middle, before and after the deletion |
| Restated native tests | `board_route_tests.rs`: the end gap, connectors leaving one side together, a hand-placed end; the reattach refusals of `board_connector_tests.rs` | Pass |
| Browser | A shape joined by a connector, moved: the connector runs to its new place | Pass, by pixels; failed before |

## Recorded differences

- **A label's size.** Native's headless engine measures no text, so its labels are padding boxes; the port measures them as the desktop app does. Labels are compared by their middles, which match to within a few thousandths of a unit (a curve's middle is found by flattening it finely, where native flattens it with kurbo's tolerance).
- **Moving objects on the canvas.** Native picks a board object whole when it is clicked; that comes with the board interface (item 10). The browser case selects the shape in the layer list and types its position.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/board_route.rs` | `board-route.ts` |
| `crates/engine/src/boards/board/connectors.rs` (`end_param`, `connector_cmd`, `make`, `connector_of`, `reattach`), `edit.rs` (`label_of`, `set_label`, `label_cmd`) | `board-commands.ts` |
| `crates/engine/src/boards/board/derived.rs` (`settle_routes`, `detach_gone_ends`, `carry_free_ends`, `place_label`, `route_mid`, `place_route`, `route`) | `board-commands.ts`, `editor.ts` |

[Property matrix](26-11-25-board-connectors-parity.html) · [Plan](../planning/26-11-25-board-connectors.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-connectors.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `9b457e5`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,701 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 443 cumulative Chromium cases passed in one 17.1-minute run at `9b457e5` with zero skips, retries, flakes or suite errors: the 442 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 13.41 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,713 nodes/41,193 edges at `9b457e5`; native 28,939/92,127 at `bad07e44`; combined 38,652/132,070. `routePoints`, `routeAlong`, `settleBoardRoutes`, `labelOf` and `reshaped` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-connectors.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "connector follows" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 4 to 10.
