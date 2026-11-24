# Upstream delta row 5, item 2: the properties an instance lists

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `dad7613`. **This bounded item passes. Five items of row 5, the other delta rows and the full port remain unfinished.**

## Implemented boundary

An instance now lists only the boolean, text and instance swap properties that a layer of its component reads, as native measured in Figma; slots always show ([`instancePropertyNames`](../../src/engine/component-variants.ts)). A set's text property for another variant, or one left from a deleted variant, shows on the set but not on this variant's instances. Both `component.properties` and the instance's Properties panel ([`InstancePanel.tsx`](../../src/InstancePanel.tsx)) use it; sets, components and variants still list every definition.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-instance-properties.json](../../tests/fixtures/native-instance-properties.json) | Two scenes: a two-variant set with a text property per variant and an unbound one; a Card with a slot, bound text, boolean and swap properties, an unbound boolean, and a deletion | Every list matches. Both scenes failed before (the instance listed every definition) |
| Browser: an instance of the Default variant switched to Selected | Its Properties show Default label, then Selected label, never Gone label. Failed on the old build |

Provenance: [the properties an instance lists](../../tests/fixtures/native-instance-properties.provenance.md).

## Recorded differences

- **Long names.** Native also cut long property names to one line in its fixed label box; the port's labels flow with the panel.
- **Earlier expectations.** One parity expectation captured before the change was re-observed natively and updated. Two browser cases changed: one now checks that a new unbound text property is not listed on the instance, as upstream changed its own tests; the other opens a native file whose instance properties are bound to no layer, which native now lists as none, so the case checks the instance offers nothing to bind. The first run of this item's gate stopped on that case; the gate was rerun after the change.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/assets/components.rs::instance_prop_list` | `component-variants.ts::instancePropertyNames` |
| `crates/engine/src/cmd/component/props.rs::describe_props` | `component-variants.ts::describeComponentProperties` |
| `crates/ui-egui/src/panels/right.rs` Properties | `InstancePanel.tsx` |

[Property matrix](26-11-24-instance-properties-parity.html) · [Plan](../planning/26-11-24-instance-properties.md) · [Parity](../../tests/parity/instance-properties.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `dad7613`, native reference `bad07e44` |
| Failing fixtures first | Both native scenes and the browser case failed before |
| Full pure suite | 5,572 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 426 cumulative Chromium cases passed in one 18.5-minute run at `dad7613` with zero skips, retries, flakes or suite errors: the 425 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 15.02 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,928 nodes/38,152 edges at `dad7613`; native 28,939/92,127 at `bad07e44`; combined 37,867/129,084. `instancePropertyNames`, `describeComponentProperties`, `InstancePanel`, `instance_prop_list` and `describe_props` verified. |

## Reproduction

```sh
npx vitest run tests/parity/instance-properties.test.ts tests/parity/component-containers.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "list only what its own variant|main property bindings, defaults" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 5 continues with item 3, a text style's weight bound to a variable.
