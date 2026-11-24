# Delta row 5, item 5: the component button's menu

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `ba52a26`: [report](../reports/26-11-24-component-create-set.md), [matrix](../reports/26-11-24-component-create-set-parity.html), [provenance](../../tests/fixtures/native-component-create-set.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `da6cec8` on `prompt/full-figcraft-port`.
- Upstream commits: `f5a52ea5`, `524ad8b1`, `253e0c3d`, `dda27030` (#2088, #2095). Ledger item 5.4.
- Files changed: `src/engine/structure.ts` (`component.createSet`, `createSetRefusal`, `canCreateSet`), `src/LayerPanel.tsx`; tests `tests/parity/component-create-set.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-component-create-set.json` with provenance.
- Next action: none; the item is recorded. Row 5 continues in its row plan.
- Blockers: none.

## Native contract

- **`cmd/component/variants.rs::create_set`** (measured in Figma): each target becomes a component, as `component.createMultiple` makes them, and all are wrapped in place in a component set 20 px around. Variants are named "Property 1=<layer name>" left to right by world position (ties by y); a name already in prop=value form is kept; layers that all share a name give a set of that name with "Property 1=Default" variants; otherwise the set is "Component N". One undo step; the set is selected.
- **`create_set_refusal`, `can_create_set`**: layers inside an instance, library copies, instances, components and component sets, and a layer inside another target are refused before the document changes; the menu offers Create component set only where it works.
- **`panels/right.rs`**: with several layers selected the component button's menu offers Create component, Create multiple components and Create component set.

## What the port had

Create component and Create multiple components; no Create component set.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/component/variants.rs::{create_set, wrap_in_set}` | `structure.ts` `component.createSet` with `variant-authoring.ts::wrapVariantSet` | Nine native scenes |
| `variants.rs::{create_set_refusal, can_create_set}` | `structure.ts::{createSetRefusal, canCreateSet}` | The refusal scenes |
| `panels/right.rs` component button menu | `LayerPanel.tsx` Create component set | Browser |

## Acceptance

- Each native observation matches; the command did not exist before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
