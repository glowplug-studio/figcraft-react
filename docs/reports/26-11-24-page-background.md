# Upstream delta row 3, item 14: page background

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `d578735`. **This bounded item passes. Four items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **Checkerboard.** A page below full opacity now shows native's transparency grid behind it: 8-point squares in the light theme's #FFFFFF and #F5F5F5, anchored at the canvas's top left. Like native, which draws the grid behind the rendered page texture, the port puts it behind the canvas element ([`canvasBackdrop`](../../src/engine/page-background-field.ts), [`Editor.tsx`](../../src/Editor.tsx)); the canvas's own pixels keep the page colour at its alpha, applied once. A 50% red page reads (255,0,0,128) on the canvas and (255,127,127) and (250,122,122) on screen.
- **Page row.** The page section shows the colour as six HEX digits and its opacity as a fractional percentage, as Fill does ([`page-background-field.ts`](../../src/engine/page-background-field.ts), [`AppearancePanel.tsx`](../../src/AppearancePanel.tsx)). A typed colour keeps the page's opacity unless it carries 4 or 8 hex digits; the port's field also takes CSS functions such as `rgba()`, which state their own alpha.

## Native reference

The behaviour is native interface code; the port restates its tests ([provenance](../../tests/fixtures/native-page-background.provenance.md)).

| Case | Result |
|---|---|
| Browser: #FF000080, then 00FF00, blue, 0000FFFF and 25.5%, then undo | The canvas shows half-opaque red over both square colours; six digits and names keep 50.2%; eight digits give 100%; the opacity field gives 25.5%; undo restores. Failed before (no such field, and a see-through canvas) |
| Browser: render-parity suites and "transparent page redraw…" | Unchanged: the canvas's own pixels stay see-through for a transparent page, as native's renderer gives. A first attempt that drew the grid into the render failed these and was replaced |
| Unit: `pageHex`, `pageOpacity`, `typedPageColour`, `canvasBackdrop` | FF0000 at 50.2%; the alpha kept or taken as native's rule says; the grid only below full opacity |

## Recorded differences

- **One theme.** The port's interface has the light theme only, so the grid takes the light tokens; native swaps them in the dark theme.
- **No page picker.** Native's swatch opens the colour picker on the page background; the port's paint picker serves fills and strokes only, so the page row has no swatch. The CSS-function input is the port's own addition, kept from the earlier field.
- **Sidebar geometry.** Native's tests of the row's width at two sidebar widths are egui layout checks with no counterpart.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/canvas/background.rs::{paint, grid_texture}` | `page-background-field.ts::{transparencyGrid, canvasBackdrop}`, `Editor.tsx` canvas background |
| `crates/ui-egui/src/panels/right.rs::page_section` | `page-background-field.ts`, `AppearancePanel.tsx` |

[Property matrix](26-11-24-page-background-parity.html) · [Plan](../planning/26-11-24-page-background.md) · [Unit](../../tests/parity/page-background-field.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `d578735`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before the change |
| Full pure suite | 5,526 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 418 cumulative Chromium cases passed in one 17.1-minute run at `d578735` with zero skips, retries, flakes or suite errors: the 417 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.95 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,875 nodes/37,881 edges at `d578735`; native 28,939/92,127 at `bad07e44`; combined 37,814/128,821. `canvasBackdrop`, `typedPageColour`, `AppearancePanel`, `page_section` and `grid_texture` verified. |

## Reproduction

```sh
npx vitest run tests/parity/page-background-field.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "translucent page draws|transparent page redraw" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- A page background picker would follow when the port's paint picker gains page targets; it is recorded here, not built.
- Row 3 continues with item 15, paint row copy and paste.
