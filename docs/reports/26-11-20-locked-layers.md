# Upstream delta row 2, item 3: locked layers

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `056c09b`. **This bounded item passes with one part left to the unported layer list. Sixteen items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #1560 (`24cf7032`, `6cb015d4`, `39e3496f`) brought locked layers in line with what was measured in the target application.

- **Lock/Unlock and Show/Hide are commands now.** The port had neither `object.toggleLock` nor `object.toggleVisible`; a layer could be locked only from the Appearance panel. [layer-flags.ts](../../src/engine/layer-flags.ts) ports native's `toggle`: without a value, Lock/Unlock locks every target unless all are locked, and locking clears the selection. A child of a locked layer counts as locked and its own flag is left alone, so it is free again once the parent is unlocked. Both are on the keyboard (Shift+Ctrl/Cmd+L and H) and in the canvas menu.
- **The arrow keys leave a locked layer alone.** [`transform.nudge`](../../src/engine/arrange.ts) and [`transform.nudgeSize`](../../src/engine/sizing.ts) skip a layer that is locked or inside a locked layer, and add no undo step when nothing moved.
- **Select layer lists locked layers.** [`select.layersAt`](../../src/engine/selection.ts) now lists every layer under the pointer, locked ones and what a locked frame holds too, each flagged. In the [canvas menu](../../src/Editor.tsx) a locked row shows a padlock, says "locked" to assistive technology, and picking it selects the layer. The submenu shows only with more than one layer under the pointer.

Already right in the port, and now pinned: a click, a Cmd/Ctrl-click and a marquee never select a locked layer or a child of a locked frame; a locked layer selected in the panel has no transform handles; its properties still edit.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-locked-layers.json](../../tests/fixtures/native-locked-layers.json) | Twelve recorded sessions of commands, clicks, a marquee and queries, with what every step gave | All twelve match: selections, receipts, flags, positions and the undo depth. The first ten failed before the Lock/Unlock command existed |

[Provenance, sources and reproduction](../../tests/fixtures/native-locked-layers.provenance.md).

These are the first observations with pointer events. The oracle gained a `session` executable that replays commands, clicks, drags and keys and reads the selection, the undo depth and whether a transform handle is under a point. [native-session.ts](../../tests/support/native-session.ts) replays the same steps against the port. The remaining pointer and keyboard items of row 2 use both.

The Select layer menu's padlock, its description and the more-than-one rule restate `crates/ui-egui/src/context_menu_tests.rs`; the native menu cannot be driven headless here.

## Earlier expectations changed

- A parity test expected a locked mask to be left out of `select.layersAt`. Observed in native, it is listed and flagged; a click still does not reach it.
- A browser case opened Select layer with one layer under the pointer. Native shows the submenu only for more than one, so the case now expects it to be absent there.

## Recorded differences

- **The Layers panel padlock.** Native's padlock on a child of a locked layer is inert, and a padlock sweep skips such rows. The port's layer list has no padlock column. This predates the item and belongs to roadmap row 19.
- **Undo depth.** The port does not expose it. The harness checks that the document is unchanged exactly where native's depth is unchanged.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/edit/select.rs::toggle` | `layer-flags.ts::toggleLayerFlag`, dispatched by `editor.ts` |
| `cmd/edit/select.rs::{nudge,nudge_size}` lock filter | `arrange.ts` `transform.nudge`, `sizing.ts` `transform.nudgeSize` |
| `crates/doc/src/geometry.rs::{HitOpts,layers_at_opts}`, `cmd/edit/select.rs::layers_at` | `selection.ts::{queryPoint,layersAt}` |
| `crates/ui-egui/src/menus/select_layer.rs`, `menus/tree.rs` | `Editor.tsx` Select layer rows |
| `crates/engine/src/keymap.rs` Shift+Cmd+L and Shift+Cmd+H; context menu entries | `Editor.tsx` shortcuts and Canvas actions buttons |

[Property matrix](26-11-20-locked-layers-parity.html) · [Plan](../planning/26-11-20-locked-layers.md) · [Lock parity](../../tests/parity/locked-layers.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `056c09b`, native reference `bad07e44` |
| Failing fixtures first | All ten first sequences failed before the change: the Lock/Unlock command did not exist. With the command alone six passed; the nudge cases and the Select layer case needed their own changes |
| Older expectations | Two, described above, changed on native evidence |
| Full pure suite | 5,188 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 390 cumulative Chromium cases passed in one 1,017-second run with zero skips, retries, flakes or suite errors: the 389 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 15.29 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,640 nodes/36,961 edges at `056c09b`; native 28,939/92,127 at `bad07e44`; combined 37,579/127,923. `toggleLayerFlag`, `layersAt`, `layers_at_opts`, `lockedIn`, `locked_in` and `replaySession` verified. |

## Verification corrections retained

Two sessions were added to the fixture after the browser gate: a locked mask and Show/Hide with refused parameters. They changed no source. The pure suite was rerun with them, 5,188 passing, before the commit.

## Reproduction

```sh
npx vitest run tests/parity/locked-layers.test.ts tests/parity/masks.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The Layers panel padlock, above.
- Hover over a locked layer was not observed; the click and marquee were.
- Row 2 continues with item 4, the Rotation field's rotation on the page.
