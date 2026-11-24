# Upstream delta row 5, item 1: inherited slot properties

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `4f762c3`. **This bounded item passes. Six items of row 5, the other delta rows and the full port remain unfinished.**

## Implemented boundary

When an instance's layers are copied, a property binding now takes its value from the innermost enclosing instance of the component that defines it, as native's `apply_enclosing_props` does ([`boundCopy`](../../src/engine/component-bindings.ts), [`component-sync.ts`](../../src/engine/component-sync.ts)). Before, it took the value at its position in the chain of enclosing instances, so slot content inside a wrapped component read the wrapping component's property of the same name.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-slot-inherited-properties.json](../../tests/fixtures/native-slot-inherited-properties.json) | Four scenes restating native `slot_tests` (default and own content, an unbound Base homonym, Boolean properties in inherited own content), 171 steps | Every Label's characters and visibility and every instance's properties match. Three scenes failed before |
| Browser: an Outer instance created in the editor over inherited own content, with Base's own Visible false | Every Label, the slot copy's included, stays visible. Failed on the old build |

Provenance: [inherited slot properties](../../tests/fixtures/native-slot-inherited-properties.provenance.md).

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/assets/components/sync.rs::{copy_layers, apply_enclosing_props}` | `component-sync.ts` (`InstanceScope` scopes), `component-bindings.ts::boundCopy` |
| `crates/engine/src/assets/components.rs::owning_component` | `component-tree.ts::owningMainComponent` |

[Property matrix](26-11-24-slot-inherited-properties-parity.html) · [Plan](../planning/26-11-24-slot-inherited-properties.md) · [Parity](../../tests/parity/slot-inherited-properties.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `4f762c3`, native reference `bad07e44` |
| Failing fixtures first | Three of four native scenes and the browser case failed before |
| Full pure suite | 5,570 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 425 cumulative Chromium cases passed in one 17.4-minute run at `4f762c3` with zero skips, retries, flakes or suite errors: the 424 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.00 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,925 nodes/38,137 edges at `4f762c3`; native 28,939/92,127 at `bad07e44`; combined 37,864/129,069. `boundCopy`, `owningMainComponent`, `InstanceScope`, `apply_enclosing_props` and `owning_component` verified. |

## Reproduction

```sh
npx vitest run tests/parity/slot-inherited-properties.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "binds slot content by its defining" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 5 continues with item 2, the properties an instance lists.
