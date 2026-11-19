# Delta row 1, item 6: path operation budgets

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `4445294`: [report](../reports/26-11-20-path-operation-budgets.md), [matrix](../reports/26-11-20-path-operation-budgets-parity.html), [provenance](../../tests/fixtures/native-variable-outline-dashes.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `18955ff` on `prompt/full-figcraft-port`.
- Upstream commit: `554ad0ea` (#2249).
- Files landed: `src/engine/variable-stroke.ts`, `path-budget.ts`, `vector-stroke.ts`, `interchange/penpot/write-geometry.ts`; tests `tests/parity/variable-stroke-dash-budget.test.ts` (new), `path-budget.test.ts`, `vector-presentation.test.ts`, `tests/fixtures/width-profile-rendering.ts`, `tests/e2e/width-profile-rendering.spec.ts`; fixture `native-variable-outline-dashes.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Upstream `554ad0ea` bounds three path operations against crafted input.

1. **Closing and the arrangement budget.** `pathops::closed` closes every open subpath and now leaves out a subpath that is a lone move; a segment drawn on from a close is open again and is closed in turn. `faces` checks the budget on the closed inputs before `plain` normalises them, because closing adds edges: 2,200 open L shapes whose segments never overlap pass the budget open and exceed it closed.
2. **Dashes of a variable-width stroke.** `width::variable_outline` keeps one allowance of `MAX_DASHES` (20,000) for all subpaths together. Each line is charged by its pattern as fitted to that line: the larger of its dash count and the pattern's length, so a short line under a long pattern still pays for the whole pattern. A line draws dashed only when its charge is strictly less than what is left and its own count is under the limit; otherwise it draws solid and is not charged.
3. **Point incidence.** `points.rs` builds the segments at each point once instead of scanning every segment per point. A loop segment counts at its `a` end only when a corner's two segments are gathered, as `VectorNetwork::incident` always did, so a point whose only segment loops back to it breaks the run and draws no corner.

## What the port had

- `arrangementFaces` already called `checkBooleanStep`, which counts open subpaths as closed, before normalising. The restated native test passed unchanged.
- The Penpot exporter closed boolean operands with its own `closedOperand`, which kept lone moves (writing a move and a close for each) and did not close a segment drawn on from a close.
- `variableStrokeOutline` checked each line alone against 20,000, with the pattern before fitting. Ten long dashed lines drew ten times the dashes.
- `vectorStrokePlan` already built adjacency once. It counted a loop segment at both ends for the corner, so a teardrop with a point join drew a corner that native does not draw. This difference predates the upstream change, which only restated the rule in a comment; it is corrected here because the item touches exactly this pass.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `pathops::closed` | `path-budget.ts::closedSubpaths`, used by `interchange/penpot/write-geometry.ts` | `closing_drops_move_only_subpaths` restated with two further cases |
| `pathops::faces` budget on closed inputs | `path-arrangement.ts::arrangementFaces` through `checkBooleanStep` (unchanged) | `faces_checks_the_closed_inputs_before_normalising` restated |
| `width::{variable_outline,dash_count,dashes_fit}` | `variable-stroke.ts::variableStrokeOutline` | Twelve native outlines in `native-variable-outline-dashes.json`; canvas pixel check |
| `points.rs::Styled::outline` corner pass | `vector-stroke.ts::vectorStrokePlan` | A teardrop with a point join draws one band |

## Hazards and known differences

- The dash allowance is per call of the outline, as in native: one layer's stroke. Strokes of several layers do not share it.
- The uniform (non-variable) dashed stroke has its own budget in `renderDashes`, which already charges all subpaths together; it is not part of this change.
- The loop-segment corner is source-derived: the native rule is read from `points.rs` and `VectorNetwork::incident` at the pinned revision, not observed through the oracle.

## Acceptance

- All twelve native outlines match in element count, piece count, bounds and area, and the five full outlines to nine decimals.
- The restated native tests pass; the dash cases, the closing case, the teardrop case and the canvas pixel check each failed before their change.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, row 1 plan and delta queue.
