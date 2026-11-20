# Delta row 2, item 2: paste placement and stacking

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `893d8a5`: [report](../reports/26-11-20-paste-placement.md), [matrix](../reports/26-11-20-paste-placement-parity.html), [provenance](../../tests/fixtures/native-paste-placement.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `747c88a` on `prompt/full-figcraft-port`.
- Upstream commits: `c74bcd0b`, `476daeab`, `ebd463fa`. Ledger item 2.7.
- Files landed: `src/engine/layer-clipboard.ts`; tests `tests/parity/paste-placement.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-paste-placement.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

`crates/engine/src/cmd/edit/clipboard.rs::paste_over`: Paste over selection pastes into the first selected layer's parent at that layer's top-left. Since `c74bcd0b` the copies that land in that parent are then moved to sit just above the selected layer, in the copied order: index of the selected layer plus one, plus the copy's place among the copies. Before, they were appended, so they went to the top of the parent's layers, and in an auto layout frame to the end of the flow. With nothing selected the copies go on the page as before. The copies become the selection.

`476daeab` adds tests only, for placements measured in the target application: plain Paste lands in place when the original is in view, at the view's centre when it is off screen, in a selected frame's centre when the frame is elsewhere, and in place inside a selected frame that holds the original. `ebd463fa` rewords a test comment.

## What the port had

`layer-clipboard.ts::pasteLayers` chose the same parent and position for `edit.pasteOver` and appended the copies. `pasteInto` already took an insertion index, which Paste to replace uses. The four placement rules were already in `placement`.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/edit/clipboard.rs::paste_over` reorder | `layer-clipboard.ts::pasteLayers`, passing the index to `pasteInto` | Seven paste-over sequences in `native-paste-placement.json`; signed-in browser workflow |
| `cmd/edit/clipboard.rs::paste` placement, as tested by `design_paste_tests.rs` | `layer-clipboard.ts::placement` (unchanged) | Four placement sequences |

## Ledger correction

The ledger put `0ad70b95` under this item. It changes how the native panel's paint rows fall back to the layer clipboard (`ui-egui/src/property_rows.rs`) and belongs with ledger item 3.18, paint row copy and paste. It is moved there.

## Hazards and known differences

- Native moves the copies after pasting and only those whose parent is the selected layer's parent, because a section pasted over a layer in a frame goes on the page. The port inserts at the index while pasting. A section is not created by a command, so that redirection was not observed through `replay`; it stays with the sections work.
- Native returns pasted ids as numbers; the port's receipts return strings. This is the recorded receipt difference in the final-audit queue.

## Acceptance

- All eleven native sequences match receipt for receipt; five failed before the change.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
