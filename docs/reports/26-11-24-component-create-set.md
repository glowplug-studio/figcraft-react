# Upstream delta row 5, item 5: the component button's menu

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `ba52a26`. **This bounded item passes. Two items of row 5, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **Create component set.** `component.createSet` makes each selected layer a component and wraps them in place in a component set 20 px around, as native measured in Figma ([`structure.ts`](../../src/engine/structure.ts)). Variants are "Property 1=<layer name>" from left to right, a prop=value name is kept, and layers that all share a name give a set of that name with "Property 1=Default" variants; otherwise the set is "Component N". One undo step; the set is selected.
- **Refusals.** Instances, components, sets, layers inside an instance and a layer inside another target are refused before the document changes (`createSetRefusal`); the Layer panel offers Create component set only where it works (`canCreateSet`, [`LayerPanel.tsx`](../../src/LayerPanel.tsx)), beside Create component and Create multiple components, which the port already had.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-component-create-set.json](../../tests/fixtures/native-component-create-set.json) | Nine scenes restating native `create_set_*`: names, order, prop=value names, a shared name, one layer, undo, and every refusal | Every id, name, position and size matches; each refusal leaves document, selection and history alone. The command did not exist before |
| Browser: three frames selected, Create component set | "Component 1" at (−20, 0) 440 × 100 with the three variants named left to right; not offered for a variant; undo removes the set |

Provenance: [Create component set](../../tests/fixtures/native-component-create-set.provenance.md).

## Recorded differences

- **Library copies.** Native also refuses library copies; the port's component commands have no library-copy check yet (its Combine as variants does not refuse them either).
- **One button, not a menu.** Native opens a menu from the Design panel header's component button; the port's Layer panel shows the three commands as buttons.
- **`object.rename`.** The scenes name layers with `node.set`; the port lacks native's `object.rename`, a separate command-inventory gap.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/component/variants.rs::{create_set, create_set_refusal, can_create_set, wrap_in_set}` | `structure.ts::{createSetRefusal, canCreateSet}`, `component.createSet`, `variant-authoring.ts::wrapVariantSet` |
| `crates/ui-egui/src/panels/right.rs` component button menu | `LayerPanel.tsx` |

[Property matrix](26-11-24-component-create-set-parity.html) · [Plan](../planning/26-11-24-component-create-set.md) · [Parity](../../tests/parity/component-create-set.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `ba52a26`, native reference `bad07e44` |
| Failing fixtures first | The command did not exist before |
| Full pure suite | 5,586 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 429 cumulative Chromium cases passed in one 17.7-minute run at `ba52a26` with zero skips, retries, flakes or suite errors: the 428 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 15.52 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,937 nodes/38,197 edges at `ba52a26`; native 28,939/92,127 at `bad07e44`; combined 37,876/129,127. `createSetRefusal`, `canCreateSet`, `wrapVariantSet`, `create_set` and `create_set_refusal` verified. |

## Reproduction

```sh
npx vitest run tests/parity/component-create-set.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "Create component set wraps" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 5 continues with item 6, a prototype connection dropped on a sibling variant.
