# Upstream delta row 4, item 3: Align unavailable in an auto layout flow

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `1ab10c7`. **This bounded item passes. One item of row 4, the other delta rows and the full port remain unfinished.**

## Implemented boundary

One selected layer that its auto layout frame places, being in the frame's flow and not absolute, now has no align target, as native measured in Figma ([`arrange.ts`](../../src/engine/arrange.ts) `canAlign`, `alignBlockedByAutoLayout`). The Align buttons are off with the tip "A layer in an auto layout frame is placed by its frame" ([`ArrangePanel.tsx`](../../src/ArrangePanel.tsx)), and the align commands change nothing and record no undo step. An absolute child still aligns to its frame, and several layers align to one another as before.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-align-auto-layout.json](../../tests/fixtures/native-align-auto-layout.json) | Nine scenes on a horizontal auto layout frame: each align command on one child, an absolute child aligned right, two children aligned, and a selected child aligned without ids | Every position and the frame's alignment match; the six single-child commands and the selected-child case leave the document object unchanged. Before, each recorded an undo step |

Provenance: [Align in an auto layout flow](../../tests/fixtures/native-align-auto-layout.provenance.md).

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/arrange.rs::{align_target, in_auto_layout_flow, align_blocked_by_auto_layout}` | `arrange.ts::{canAlign, inAutoLayoutFlow, alignBlockedByAutoLayout}` |
| `crates/ui-egui/src/panels/right.rs` Align tip | `ArrangePanel.tsx` |

[Property matrix](26-11-24-align-auto-layout-parity.html) · [Plan](../planning/26-11-24-align-auto-layout.md) · [Parity](../../tests/parity/align-auto-layout.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `1ab10c7`, native reference `bad07e44` |
| Failing fixtures first | Seven of ten new cases failed before |
| Full pure suite | 5,561 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 423 cumulative Chromium cases passed in one 17.6-minute run at `1ab10c7` with zero skips, retries, flakes or suite errors: the 422 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 15.94 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,917 nodes/38,102 edges at `1ab10c7`; native 28,939/92,127 at `bad07e44`; combined 37,856/129,038. `canAlign`, `alignBlockedByAutoLayout`, `ArrangePanel`, `align_blocked_by_auto_layout` and `can_align` verified. |

## Reproduction

```sh
npx vitest run tests/parity/align-auto-layout.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "Align is off with a tip" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Native notes that Tidy up was measured to differ from Figma and left unchanged; the port's Tidy follows native.
- Row 4 closes with item 4, the auto layout drag reorder.
