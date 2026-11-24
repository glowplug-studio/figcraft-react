# Upstream delta row 4, item 4: the auto layout drag reorder

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `ab5c190`. **This bounded item passes and closes row 4. The other delta rows and the full port remain unfinished.**

## Implemented boundary

A child dragged within its own non-wrapping auto layout row or column now takes its slot from the leading edge of the box it would fill, as native measured in Figma, not from the pointer ([`prepareAutoLayoutSlot`](../../src/engine/layout-navigation.ts), [`placeMove`](../../src/engine/layout-drop.ts)). The box is its start bounds (several layers' combined bounds) moved by the pointer's own drag before snapping ([`move-interaction.ts`](../../src/engine/move-interaction.ts)). Forward, it passes a sibling once its high edge passes the sibling's middle; backward or with no move along the flow, once its low edge does. Wrapping layouts, grids and drags in from another frame keep their rules.

## Native reference

| Case | Result |
|---|---|
| Unit: the seven leading-edge tests of native `al_drag_tests` as five cases | Every boundary matches: 49 / 50 and 129 / 130 both ways, rows and columns, the grab point, no move along the flow, two layers together. Four of five failed before ([provenance](../../tests/fixtures/native-auto-layout-drag-reorder.provenance.md)) |
| Browser: a child dragged by 49, then by 50, in the editor | Unchanged, then past its neighbour. The old build kept it in place at 50 |

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/canvas/drop.rs::{auto_layout_slot_within, slot_in}` | `layout-navigation.ts::prepareAutoLayoutSlot` |
| `crates/engine/src/canvas/tools/drag.rs` (`within`, `raw`) | `layout-drop.ts::placeMove`, `editor.ts::previewMove`, `move-interaction.ts` |

[Property matrix](26-11-24-auto-layout-drag-reorder-parity.html) · [Plan](../planning/26-11-24-auto-layout-drag-reorder.md) · [Unit](../../tests/parity/auto-layout-drag-reorder.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `ab5c190`, native reference `bad07e44` |
| Failing fixtures first | Four of five restated cases and the browser case failed before |
| Full pure suite | 5,566 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 424 cumulative Chromium cases passed in one 18.3-minute run at `ab5c190` with zero skips, retries, flakes or suite errors: the 423 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 15.96 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,921 nodes/38,122 edges at `ab5c190`; native 28,939/92,127 at `bad07e44`; combined 37,860/129,055. `prepareAutoLayoutSlot`, `placeMove`, `previewMove`, `auto_layout_slot_within` and `slot_in` verified. |

## Reproduction

```sh
npx vitest run tests/parity/auto-layout-drag-reorder.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "leading edge reaches the sibling" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 4 is closed; delta row 5 (components and variables) is next.
