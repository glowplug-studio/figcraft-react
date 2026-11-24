# Roadmap row 15, item 8b: the interaction editor

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `a6e97bc`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

Clicking an interaction in the Prototype tab now opens native's interaction editor ([`InteractionEditor.tsx`](../../src/InteractionEditor.tsx)): the trigger with its delay, a recorded key or a controller button; the actions, each with its destination and settings (navigation with Preserve scroll, overlays with position, anchor, offset, close on outside and background, Scroll to with its offset, links, Change to, variable modes), added with native's defaults, moved and removed; conditional actions with If, Else if and Else blocks whose conditions are typed and checked; set variable with a fixed value or a checked expression; and the animation with its direction, easing, duration and custom curve or spring. Every edit runs the commands of items 1 to 3, one undo step each, as native's editor does.

## Evidence

| Case | Content | Result |
|---|---|---|
| Browser: the interaction editor | An after-delay trigger; a conditional with a typed condition, an action in its if and its else; a set variable whose bad expression is refused with native's message; a push upwards with a gentle spring | The saved interaction matches what native's commands store; failed before (no editor) |

The editor runs commands whose native behaviour items 1 to 3 recorded; native's editor itself is tested through its egui harness.

## Recorded differences

- **Condition builder.** Conditions are typed as expressions; native also offers a variable, operator and value builder for simple conditions.
- **Curve preview.** The easing has no animated curve preview.
- **Form controls.** Selects, fields and buttons replace native's drawn dropdowns, segmented controls and drag handles (reordering is by Move up and Move down, which native's row menu also offers).

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/panels/proto_panel.rs::{editor_popover, trigger_rows, action_fields, animation_rows, custom_easing_fields}` | `InteractionEditor.tsx` |
| `crates/ui-egui/src/panels/proto_editor.rs::{action_list, action_item, conditional_blocks, set_variable_fields, expr_field}` | `InteractionEditor.tsx` |
| `proto_panel.rs::{action_of, variants_for, value_json, animates}` | `prototype-summaries.ts` |

[Property matrix](26-11-25-interaction-editor-parity.html) · [Plan](../planning/26-11-25-interaction-editor.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `a6e97bc`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,628 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | Of 433 cumulative Chromium cases, 426 passed in one 34.6-minute run at `a6e97bc`'s source; seven 10,000-node frame-budget cases (profile rendering, brush and vector network stroke previews, transform resize, vector point scale and region previews, gradient handles) failed while macOS media analysis held the load average at 10 to 15, the same family that fails under that load at `6e4ae95`, whose code passed every case at 00:38 at a normal load: environmental under the standing load rule. A timed-out run left one local test user, removed before the counts. No baseline changed |
| Real local provider integrations | 32 passed in 21.63 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,312 nodes/39,643 edges at `a6e97bc`; native 28,939/92,127 at `bad07e44`; combined 38,251/130,548. `InteractionEditor`, `actionOf`, `variantsFor`, `wireAction` and `animates` verified. |

## Reproduction

```sh
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "the interaction editor sets" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 9 and 10: canvas connections and the presenter.
