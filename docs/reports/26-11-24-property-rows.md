# Upstream delta row 3, item 15: paint row copy and paste

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `c0c2a9d`. **This bounded item passes. Three items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **Highlight.** A click on a fill, stroke or effect row's background, or on an effect row's drag strip, highlights it in the selected-row colour for the selection ([`PropertyRow.tsx`](../../src/PropertyRow.tsx), [`editor.ts`](../../src/engine/editor.ts) `highlightPropertyRow`). Another selection, Escape, a press on the canvas or elsewhere in the Design panel, or an undo that takes its paint away lets it go; it follows its paint when rows move or one is removed ([`followIndex`](../../src/engine/property-rows.ts)).
- **Copy.** Cmd/Ctrl+C with a highlighted row copies that paint or effect instead of the layers; the system clipboard gets a solid's hex code or `figcraft://clipboard/<kind>` (`copyPropertyRow`, [`Editor.tsx`](../../src/Editor.tsx) `copyLayers`). A programmatic copy writes nothing there.
- **Paste.** While that copy is the last thing copied and the clipboard still holds its mirror, Cmd/Ctrl+V pastes it onto every selected layer, in place of the highlighted row of that kind else on top, in one undo step (`pasteProperty`). A copy whose engine copy is gone pastes nothing rather than older layers; another app's text or a later layer copy pastes as before.

## Native reference

The behaviour is native interface code; the port restates the native property row tests ([provenance](../../tests/fixtures/native-property-rows.provenance.md)).

| Case | Result |
|---|---|
| Unit: ten cases over the engine | All pass, covering eighteen of the twenty-five native tests |
| Browser: highlight, Escape, copy (`#FF0000`), paste on top, paste in place, effect marker and paste, a press elsewhere, a layer copy without a highlight | All pass. The port had no row targets, so the case could not run before |

## Recorded differences

- **Menus and windows.** Edit ▸ Copy from the port's menu and the row menus' Copy keep their earlier paths (the row menu copies without a clipboard mirror), and the port has one window per tab, so three native tests have no counterpart.
- **Region fills.** In vector edit mode with regions selected, the fill rows show the regions' fills and take no highlight in the port.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/property_rows.rs::{Highlight, current, click, escape, follow, reconcile}` | `editor.ts::{propertyRow, highlightPropertyRow, clearPropertyRow}`, `property-rows.ts::followIndex`, `PropertyRow.tsx` |
| `crates/ui-egui/src/property_rows.rs::{copy_highlighted, copy, paste}` | `editor.ts::{copyPropertyRow, copyProperty, pasteProperty}`, `Editor.tsx` copy and paste |

[Property matrix](26-11-24-property-rows-parity.html) · [Plan](../planning/26-11-24-property-rows.md) · [Unit](../../tests/parity/property-rows.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `c0c2a9d`, native reference `bad07e44` |
| Failing fixtures first | The new engine methods and row targets did not exist before |
| Full pure suite | 5,536 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 419 cumulative Chromium cases passed in one 16.7-minute run at `c0c2a9d` with zero skips, retries, flakes or suite errors: the 418 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.85 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,896 nodes/37,997 edges at `c0c2a9d`; native 28,939/92,127 at `bad07e44`; combined 37,835/128,935. `pasteProperty`, `copyPropertyRow`, `propertyRowProps`, `copy_highlighted` and `reconcile` verified. |

## Reproduction

```sh
npx vitest run tests/parity/property-rows.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "row highlights it" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- The row menus' Copy could write the same clipboard mirror, as native's does; recorded, not built.
- Row 3 continues with item 16, zoomed-out image copies.
