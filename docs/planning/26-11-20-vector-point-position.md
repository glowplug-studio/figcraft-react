# Delta row 1, item 8: point positions in vector edit mode

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `d51ac59`: [report](../reports/26-11-20-vector-point-position.md), [matrix](../reports/26-11-20-vector-point-position-parity.html), [provenance](../../tests/fixtures/native-vector-point-position.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `6c06b12` on `prompt/full-figcraft-port`.
- Upstream commits: `6ac20c7d`, `8edcc02a`, `dc841f85`.
- Files landed: `src/engine/vector-edit-commands.ts`, `src/engine/vector-edit.ts`, `src/VectorPanel.tsx`; tests `tests/parity/vector-point-position.test.ts` (new), `tests/unit/VectorPanel.test.tsx` (new), `tests/e2e/preview.spec.ts`; fixture `native-vector-point-position.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## How this item was found

No row of the upstream delta queue named this change. Reading the whole upstream range for the vector edit code while working on item 7 showed three commits to `vector.edit.position` and the Point section. The port's command still had the behaviour the first of them replaced.

## Native contract

`vector.edit.position {x?, y?}`, in `crates/engine/src/canvas/vectoredit.rs`:

- Each axis is absent or null (the coordinate is kept), a number (every selected point's own coordinate becomes it), or exactly one of `{add: n}`, `{mul: n}`, `{div: n}` with a finite number (applied to each point's own coordinate). A zero divisor, any other shape, a boolean and a non-finite result are refused, and a refused axis changes neither.
- Values are in the parent's coordinates: a point's coordinate is the layer's transform applied to it, and the target is taken back through the inverse.
- The selected points are the selected points plus the ends of selected segments. With none, the command is refused with "select points".
- Each point moves by its own offset, with its handles, in one undo step. When every moved point shares one offset (within 1e-9) they move in one call, so a move of every point carries the regions' paint frames as a drag does.

The panel (`crates/ui-egui/src/panels/vector_panel.rs`): X and Y each show the value the selected points share within 1e-6, rounded to two decimals, or Mixed. A typed value sets every selected point's own coordinate on that axis. A relative edit typed into the field (`+10`, `*2`) is sent as `{add}`, `{mul}` or `{div}`.

Before `6ac20c7d` the fields showed the selection's top-left and the command moved the selection as a group so that its top-left landed on the typed value. `vector.edit.bounds` still reports that top-left.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `vectoredit.rs::{AxisEdit,axis_edit}` and the `vector.edit.position` handler | `vector-edit-commands.ts::axisEdit` and the `vector.edit.position` case | Eleven native sequences in `native-vector-point-position.json`; the paint-frame test restated at the command level |
| `vectoredit.rs::selected_parent_points` | `vector-edit.ts::selectedParentPoints` | Panel unit test |
| `vector_panel.rs::points` shared value | `vector-edit.ts::sharedPointPosition`, `VectorPanel.tsx` | Panel unit test restating `vector_point_xy_tests.rs`; signed-in browser workflow |
| `vectoredit.rs::selection_position` for `vector.edit.bounds` | `vector-edit.ts::vectorSelectionPosition` (unchanged) | Existing cases |

## Hazards and known differences

- The port's form has one Apply button for both fields. It sends only an axis whose text was changed from what is shown, so an untouched shared value is not written back from its two-decimal display, and an untouched Mixed field keeps each point's own coordinate.
- Relative edits typed into a field have no counterpart in the port's number inputs; the command accepts the relative forms. This belongs to roadmap row 19.
- Scrubbing the field (the third native panel test) has no counterpart in the port's inputs.
- Native takes an undo step for a position command that moves nothing; the port takes none. This is a property of the history, found here and queued for the final audit.
- Error texts follow the port's convention (no command prefix) and name the same cause as native's.

## Acceptance

- All eleven native sequences match; the refused forms throw, change nothing and leave no undo step.
- Nine of the eleven sequences failed before the change. The panel had no Mixed state before: it showed the selection's top-left.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, row 1 plan and delta queue.
