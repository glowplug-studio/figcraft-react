# Delta row 2, item 3: locked layers

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `056c09b`: [report](../reports/26-11-20-locked-layers.md), [matrix](../reports/26-11-20-locked-layers-parity.html), [provenance](../../tests/fixtures/native-locked-layers.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `6ad402b` on `prompt/full-figcraft-port`.
- Upstream commits: `24cf7032` (#1560, #2219), `6cb015d4`, `39e3496f`, `87f7b7d9`. Ledger item 2.2.
- Files landed: `src/engine/layer-flags.ts` (new), `src/engine/editor.ts`, `arrange.ts`, `sizing.ts`, `selection.ts`, `src/Editor.tsx`; tests `tests/parity/locked-layers.test.ts` (new), `tests/support/native-session.ts` (new), `tests/parity/masks.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-locked-layers.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Measured by upstream in the target application and described in its help article on locking layers.

- **The canvas never reaches a locked layer.** A click, a Cmd/Ctrl-click, hover and a marquee select neither a locked layer nor anything inside a locked frame.
- **A locked layer selected in the Layers panel** has no transform handles and ignores the arrow keys: `transform.nudge` and `transform.nudgeSize` skip a layer that is locked or inside a locked layer, and add no undo step when nothing moved. Its properties still edit.
- **Lock/Unlock** (`object.toggleLock`, Shift+Cmd/Ctrl+L): without a value, if every target is locked they are unlocked, otherwise all are locked. A child of a locked layer counts as locked, and the command leaves its own flag alone, so the flag still holds once the parent is unlocked. An explicit `locked` value sets it anyway. Locking clears the selection.
- **Select layer** in the canvas context menu lists every layer under the pointer, locked ones too, each row flagged when the layer or an ancestor is locked (`select.layersAt` gives `locked`). A locked row shows a padlock, says "locked" to assistive technology, and picking it selects it. The submenu shows only with more than one layer under the pointer.
- In the Layers panel the padlock on a child of a locked layer is inert and a padlock sweep skips such rows.

`object.toggleVisible` shares the command's function: without a value, if every target is visible they are hidden, otherwise all are shown.

## What the port had

- `lockedIn` and the canvas hit test already kept clicks, deep clicks and marquees away from locked layers, and the transform handles were already withheld.
- There was no `object.toggleLock` or `object.toggleVisible` command; the command inventory lists both as unported. A layer was locked through `node.set` from the Appearance panel only.
- `transform.nudge` and `transform.nudgeSize` moved and resized locked layers.
- `select.layersAt` left locked layers out and had no `locked` field; the Select layer submenu showed for a single layer.
- The Layers panel has no padlock column.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/edit/select.rs::toggle` | `src/engine/layer-flags.ts::toggleLayerFlag`, dispatched by `editor.ts` | Native sequences in `native-locked-layers.json` |
| `cmd/edit/select.rs::{nudge,nudge_size}` lock filter | `arrange.ts` `transform.nudge`, `sizing.ts` `transform.nudgeSize` | The same fixture, including the undo depth |
| `doc/geometry.rs::{HitOpts,layers_at_opts}`, `cmd/edit/select.rs::layers_at` | `selection.ts::{queryPoint,layersAt}` | The same fixture |
| `canvas/tools` pick and marquee over locked layers | `move-interaction.ts`, `canvas-selection.ts::lockedIn` (unchanged) | The same fixture, through pointer steps |
| `ui-egui/menus/select_layer.rs`, `menus/tree.rs` padlock and description | `Editor.tsx` Select layer rows | Signed-in browser workflow |
| `engine/keymap.rs` Shift+Cmd+L and Shift+Cmd+H; context menu entries | `Editor.tsx` shortcuts and Canvas actions buttons | Signed-in browser workflow for Lock/Unlock |

## A new oracle executable

Earlier items observed commands only. This one needs clicks and a marquee, so the oracle gained `session`: it replays commands, pointer events (`Session::pointer`), keys (`Session::tool_key`), Escape, and reads the selection, the undo depth and whether a transform handle is under a point. `tests/support/native-session.ts` replays the same recorded steps against the port through `MoveInteraction` and `TransformInteraction`. Later pointer and keyboard items of row 2 use both.

## Hazards and known differences

- The port exposes no undo depth. The harness checks that the document object is unchanged exactly where native's depth is unchanged.
- The Layers panel padlock and its sweep have no counterpart: the port's layer list has no padlock column. This belongs to roadmap row 19 and is recorded, not built here.
- Two earlier expectations changed on native observations: a locked mask is now listed by `select.layersAt`, and the Select layer submenu no longer shows for one layer.

## Acceptance

- All native sequences match; each failed before the change for the reason the item names.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
