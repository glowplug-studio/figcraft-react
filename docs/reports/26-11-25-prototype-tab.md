# Roadmap row 15, item 8a: the prototype tab

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `81c6c58`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

The right panel now has native's Design and Prototype switch (pressed buttons, since the document tabs above the canvas are the page's ARIA tabs). The Prototype tab ([`PrototypePanel.tsx`](../../src/PrototypePanel.tsx)) shows, with nothing selected, the page's flow starting points (present, preview, rename, remove, with their descriptions) and its prototype settings (device, rotation, colour, custom size, responsive, background); for a top-level frame, its flow starting point and description; for layers, their interactions summarised as native's panel words them, added (a click navigating to another frame, or Back) and removed, with native's handling of mixed selections; and scroll behaviour (a layer's position in its frame, a frame's overflow). Its words and defaults come from [`prototype-summaries.ts`](../../src/engine/prototype-summaries.ts).

## Evidence

| Case | Content | Result |
|---|---|---|
| Browser: the Prototype tab | A flow added and renamed; a device, colour and rotation picked; responsive and a background set; two interactions added, one removed; a scroll position and an overflow set | The saved file carries each; failed before (no tab) |
| Unit: summaries and defaults | Trigger and action summaries, the default new interaction, the layers an edit applies to, navigation targets | Pass, following native's panel code |

This is interface work: native's panel is tested through its egui harness, so the port's evidence is its own browser case and the commands' native observations (items 1, 4 and 7b).

## Recorded differences

- **Replace on a mixed selection** clears and adds in two undo steps; native batches them into one with `command.batch`, which the port does not have yet.
- **The interaction editor** (clicking an interaction) is item 8b; its browser cases for expressions, actions and conditionals stay in the deferred queue.
- **Form controls.** The port uses its own selects, fields and buttons in place of native's drawn dropdowns, swatches and icons.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/panels/proto_panel.rs` (the tab's sections) | `PrototypePanel.tsx` |
| `proto_panel.rs::{trigger_summary, action_summary, action_of, targets_for, nav_targets}` | `prototype-summaries.ts` |

[Property matrix](26-11-25-prototype-tab-parity.html) · [Plan](../planning/26-11-25-prototype-tab.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Unit](../../tests/unit/prototype-summaries.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `81c6c58`, native reference `bad07e44` |
| Failing fixtures first | The browser and unit cases failed before |
| Full pure suite | 5,628 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | Of 432 cumulative Chromium cases, 426 passed in one 30.2-minute run at `81c6c58`'s source; six 10,000-node frame-budget cases (profile rendering, stroke previews, vector point previews) failed while macOS media analysis held the load average at 12 to 18, and the same specs fail at the previous commit `6e4ae95` under that load, so they are environmental timing failures under the standing load rule; two earlier runs of this item were cut short by the same load. No baseline changed |
| Real local provider integrations | 32 passed in 13.04 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,275 nodes/39,462 edges at `81c6c58`; native 28,939/92,127 at `bad07e44`; combined 38,214/130,368. `PrototypePanel`, `actionSummary`, `triggerSummary`, `newInteractionAction` and `interactionTargets` verified. |

## Reproduction

```sh
npx vitest run tests/unit/prototype-summaries.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "the Prototype tab adds" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 8b to 10.
