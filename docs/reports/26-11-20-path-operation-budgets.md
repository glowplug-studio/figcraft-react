# Upstream delta row 1, item 6: path operation budgets

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `4445294`. **This bounded item passes. One item of row 1, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2249 (`554ad0ea`) bounds three path operations against crafted input. The port stood differently on each.

1. **Dashes of a variable-width stroke share one allowance.** Native keeps 20,000 dashes for all subpaths of a stroke together and charges each line by the pattern fitted to it, so a short line under a long pattern pays for the whole pattern. Lines past the allowance draw solid. The port checked each line alone, so ten long dashed lines drew ten times the dashes. [`variableStrokeOutline`](../../src/engine/variable-stroke.ts) now keeps the shared allowance.
2. **Closing leaves out lone moves.** Native `pathops::closed` drops a subpath that is only a move, and closes a segment drawn on from a close. The port's Penpot exporter had its own version that did neither. [`closedSubpaths`](../../src/engine/path-budget.ts) is the native function, and the exporter uses it.
3. **The arrangement refuses its closed inputs.** Native now checks the budget after closing and before normalising. The port already did: `arrangementFaces` counts open subpaths as closed first. The native test is restated and passed without a change.

The upstream change also indexes the segments at each point once. The port already gathered them in one pass. Reading that pass showed a difference that predates the change: a point whose only segment loops back to it drew a join corner in the port and draws none in native. [`vectorStrokePlan`](../../src/engine/vector-stroke.ts) now skips it.

## Observable effects

- A vector of several very long dashed variable-width lines draws dashes until the allowance is used and solid strokes after it, instead of tens of thousands of extra pieces.
- A teardrop with its own point join no longer shows a join mark at its point.
- Ordinary dashed strokes are unchanged.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-variable-outline-dashes.json](../../tests/fixtures/native-variable-outline-dashes.json) | Twelve strokes outlined by native `variable_outline`: element count, piece count, bounds and area, and every element for the five small ones | All twelve match. Before the change the six cases the allowance reaches disagreed (15,002 pieces against 7,502; 200,100 against 8,100) and the six it does not reach already matched, the five full outlines to nine decimals |

[Provenance, sources and reproduction](../../tests/fixtures/native-variable-outline-dashes.provenance.md).

Two native tests are restated without a new observation, because they state their expectation in the source: `faces_checks_the_closed_inputs_before_normalising` and `closing_drops_move_only_subpaths`. The loop-segment rule is read from `points.rs` and `VectorNetwork::incident` at the pinned revision.

## Native mapping

| Native | React |
|---|---|
| `crates/pathops/src/width.rs::{variable_outline,dash_count,dashes_fit}` | `variable-stroke.ts::variableStrokeOutline` |
| `crates/pathops/src/lib.rs::closed` | `path-budget.ts::closedSubpaths`, used by `interchange/penpot/write-geometry.ts` |
| `crates/pathops/src/lib.rs::faces` budget on closed inputs | `path-arrangement.ts::arrangementFaces` through `checkBooleanStep` (unchanged) |
| `crates/pathops/src/points.rs::Styled::outline` corner pass | `vector-stroke.ts::vectorStrokePlan` |

[Property matrix](26-11-20-path-operation-budgets-parity.html) · [Plan](../planning/26-11-20-path-operation-budgets.md) · [Dash parity](../../tests/parity/variable-stroke-dash-budget.test.ts) · [Budget parity](../../tests/parity/path-budget.test.ts) · [Presentation parity](../../tests/parity/vector-presentation.test.ts) · [Browser](../../tests/e2e/width-profile-rendering.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `4445294`, native reference `bad07e44` |
| Failing fixtures first | Six of the twelve native dash cases, the restated native dash test, the closing case, the teardrop case and the canvas pixel check each failed before their change. The arrangement case passed unchanged |
| Full pure suite | 5,065 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 385 cumulative Chromium cases passed in one 935-second run with zero skips, retries, flakes or suite errors: the 384 earlier cases and the new canvas pixel check. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.24 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,567 nodes/36,678 edges at `4445294`; native 28,939/92,127 at `bad07e44`; combined 37,506/127,649. `closedSubpaths`, `variableStrokeOutline`, `variable_outline`, `dash_count` and `vectorStrokePlan` verified. |

## Reproduction

```sh
npx vitest run tests/parity/variable-stroke-dash-budget.test.ts tests/parity/path-budget.test.ts tests/parity/vector-presentation.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
npx playwright test tests/e2e/width-profile-rendering.spec.ts --workers=1 --retries=0
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- No Penpot export case holds a boolean operand with a lone move; `closedSubpaths` is tested on its own.
- The loop-segment corner is source-derived, not observed through the oracle.
- No case measures the cost of the per-point join pass; the port builds its adjacency in one pass by inspection.
- Row 1 continues with item 7, vector bridge, delete and flatten loops (#1951, #2195).
