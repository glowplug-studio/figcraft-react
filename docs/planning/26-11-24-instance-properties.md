# Delta row 5, item 2: the properties an instance lists

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `dad7613`: [report](../reports/26-11-24-instance-properties.md), [matrix](../reports/26-11-24-instance-properties-parity.html), [provenance](../../tests/fixtures/native-instance-properties.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `d874472` on `prompt/full-figcraft-port`.
- Upstream commit: `14670b99` (#2022). Ledger item 5.2.
- Files changed: `src/engine/component-variants.ts` (`instancePropertyNames`, `describeComponentProperties`), `src/InstancePanel.tsx`; tests `tests/parity/instance-properties.test.ts` (new), one new and two updated cases in `tests/e2e/preview.spec.ts`, one updated expectation in `tests/parity/component-containers.test.ts`; fixture `tests/fixtures/native-instance-properties.json` with provenance.
- Next action: none; the item is recorded. Row 5 continues in its row plan.
- Gate note: the first gate run stopped on "scoped layer fields bind…" (375 passed, 50 not run): its native file's instance properties are bound to no layer, so native lists none. The case was updated to that native result and the gate rerun.
- Blockers: none.

## Native contract

- **`engine/src/assets/components.rs::instance_prop_list`**: an instance lists its component's properties without the boolean, text and instance swap ones no layer of the component reads; slots stay. The walk enters the component's layers and nested instances' own nodes but not a nested instance's layers or a slot's own content. `component.properties` and the Properties panel use it for instances; sets, components and variants list every definition.
- The same commit cut long property names to one line in native's 84 × 20 label box; the port's form labels wrap with the panel, so that half has no counterpart.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/assets/components.rs::instance_prop_list` | `component-variants.ts::instancePropertyNames` | Two native scenes |
| `engine/src/cmd/component/props.rs::describe_props` | `component-variants.ts::describeComponentProperties` | The same; one older expectation re-observed |
| `ui-egui/src/panels/right.rs` Properties | `InstancePanel.tsx` | Browser |

## Acceptance

- Each native observation matches; both new scenes failed before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
