# Upstream delta row 1, item 8: point positions in vector edit mode

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `d51ac59`. **This bounded item passes and completes row 1 of the upstream delta queue. The other delta rows and the full port remain unfinished.**

## How this item was found

No row of the delta queue named it. While working on item 7, the whole upstream range for the vector edit code was read, and three commits (`6ac20c7d`, `8edcc02a`, `dc841f85`) changed `vector.edit.position` and the Point section of the panel. The port still had the behaviour the first of them replaced.

## Implemented boundary

With several points selected in vector edit mode:

- **The command.** [`vector.edit.position`](../../src/engine/vector-edit-commands.ts) takes, per axis, a number or one of `{add}`, `{mul}`, `{div}`. A number becomes that coordinate of every selected point; a relative form applies to each point's own value. Values are in the parent's coordinates. Each point moves by its own offset with its handles, in one undo step. When every moved point shares one offset they move together, so the regions' paint frames go with them. Malformed parameters and an empty selection are refused and change nothing.
- **The panel.** The [Point section](../../src/VectorPanel.tsx) shows the X and Y the selected points share, to two decimals, or Mixed. Applying sends only the axis whose text was changed, so an untouched field keeps each point's own coordinate.

Before, the fields showed the selection's top-left and a typed value moved the selection as a group so that its top-left landed on it. Relative forms were ignored and malformed parameters accepted. `vector.edit.bounds` still reports the top-left, as in native.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-vector-point-position.json](../../tests/fixtures/native-vector-point-position.json) | Eleven command sequences with the network and `node.get` receipt before and after each position command, and the error of each refused one | All eleven match: points and handles to nine decimals, receipts equal, every refused form throws and leaves the snapshot unchanged. Nine disagreed before the change |

[Provenance and reproduction](../../tests/fixtures/native-vector-point-position.provenance.md).

The paint-frame case of the native tests is restated at the command level with the frame placed on the region directly, as the native test places it. The panel cases restate `crates/ui-egui/src/vector_point_xy_tests.rs`; the native panel cannot be driven headless here.

## Recorded differences

- **Relative edits and scrubbing in the field.** Native accepts `+10` or `*2` typed into a Mixed field and scrubs a shared value. The port's number inputs take absolute values and do not scrub. The command accepts the relative forms. This predates the item and belongs to roadmap row 19.
- **One Apply button.** Native commits each field on its own; the port's form has one button for both and sends only what changed.
- **An empty move takes an undo step in native and none in the port.** Found while observing the refusals: a position command that moves nothing succeeds in native and can be undone as an empty step. This is a property of the history, not of this command, and is added to the final-audit queue.
- **Error texts** follow the port's convention, without the command prefix, and name the same cause.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/canvas/vectoredit.rs::{AxisEdit,axis_edit}` and the `vector.edit.position` handler | `vector-edit-commands.ts::axisEdit` and the `vector.edit.position` case |
| `vectoredit.rs::selected_parent_points` | `vector-edit.ts::selectedParentPoints` |
| `crates/ui-egui/src/panels/vector_panel.rs::points` shared value | `vector-edit.ts::sharedPointPosition`, `VectorPanel.tsx` |
| `vectoredit.rs::selection_position` | `vector-edit.ts::vectorSelectionPosition` (unchanged; `vector.edit.bounds`) |

[Property matrix](26-11-20-vector-point-position-parity.html) · [Plan](../planning/26-11-20-vector-point-position.md) · [Position parity](../../tests/parity/vector-point-position.test.ts) · [Panel](../../tests/unit/VectorPanel.test.tsx) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `d51ac59`, native reference `bad07e44` |
| Failing fixtures first | Nine of the eleven sequences and the error-text case failed before the change. The panel had no Mixed state before |
| Full pure suite | 5,116 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 387 cumulative Chromium cases passed in one 940-second run with zero skips, retries, flakes or suite errors: the 386 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.08 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,599 nodes/36,814 edges at `d51ac59`; native 28,939/92,127 at `bad07e44`; combined 37,538/127,780. `axisEdit`, `axis_edit`, `selectedParentPoints`, `selected_parent_points` and `sharedPointPosition` verified. |

## Verification corrections retained

- The first form of the browser workflow read the layer's geometry from the "Selected vector" region, which is not shown in vector edit mode. The case now checks the panel's own fields and, at the end, that an unselected corner is where the rectangle put it.
- The first native run of the refusal case ended with commands that move nothing, followed by an undo, and the undo removed an empty step. The case was changed to end with a real move and its undo, and the history difference recorded above.

## Reproduction

```sh
npx vitest run tests/parity/vector-point-position.test.ts tests/unit/VectorPanel.test.tsx --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The differences recorded above.
- Row 1 of the delta queue is complete. The queue continues with row 2: paste stacking, inherited locks and picking, marquee measurements, Escape, arrow-key pan, zoom margins, layer selection, rename traversal, count handles and tidy ordering.
