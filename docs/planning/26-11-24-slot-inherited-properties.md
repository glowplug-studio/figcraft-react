# Delta row 5, item 1: inherited slot properties

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `4f762c3`: [report](../reports/26-11-24-slot-inherited-properties.md), [matrix](../reports/26-11-24-slot-inherited-properties-parity.html), [provenance](../../tests/fixtures/native-slot-inherited-properties.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `aaffdab` on `prompt/full-figcraft-port`.
- Upstream commits: `a6d9b74d`, `a66946d1`, `2067a0b5`. Ledger item 5.1.
- Files changed: `src/engine/component-bindings.ts` (`boundCopy`, `InstanceScope`), `src/engine/component-sync.ts` (scopes carry each enclosing instance's component); tests `tests/parity/slot-inherited-properties.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-slot-inherited-properties.json` with provenance.
- Next action: none; the item is recorded. Row 5 continues in its row plan.
- Blockers: none.

## Native contract

- **`engine/src/assets/components/sync.rs::apply_enclosing_props`**: when an instance's layers are copied, a layer's property binding takes the values of the innermost enclosing instance of the component that owns the bound layer (`owning_component`), not of the instance at the binding's position in the chain. Slot content therefore skips a hop through its slot's component, and a property of the same name on a wrapping component is not read.

## What the port had

`boundCopy` took the values at the binding's position in the chain of enclosing instances, so in inherited own content a Label bound to Content's Visible read the Base's Visible.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/assets/components/sync.rs::{copy_layers, apply_enclosing_props}` | `component-sync.ts` scopes, `component-bindings.ts::boundCopy` | Four native scenes, 171 steps; browser |
| `engine/src/assets/components.rs::owning_component` | `component-tree.ts::owningMainComponent` (unchanged) | The same |

## Acceptance

- Each native observation matches; three of the four scenes failed before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
