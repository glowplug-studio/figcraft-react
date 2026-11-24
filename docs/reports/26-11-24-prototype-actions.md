# Roadmap row 15, item 3: action and conditional-block commands

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `10f91d4`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

The interaction editor builds conditional actions one action and one block at a time. [`prototype-commands.ts`](../../src/engine/prototype-commands.ts) now has native's `proto.action.add`, `set`, `remove` and `move`, which address an action by a path through conditional actions and their blocks, and `proto.conditional.addBlock`, `setCondition` and `removeBlock`, with native's limits (200 actions in a list, 50 blocks), checks (a set variable's variable and expression, conditions, destinations), default condition and messages. Each edits interaction `index` of every target that has it, all or nothing.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-prototype-actions.json](../../tests/fixtures/native-prototype-actions.json) | 62 steps: adding, replacing, removing and reordering actions by path, blocks and conditions, refusals, several targets, and the stored actions at three saves | Every receipt, error and stored action matches. Failed before |

Provenance: [prototype action and conditional-block commands](../../tests/fixtures/native-prototype-actions.provenance.md).

## Recorded differences

- **No browser case.** The interaction editor (item 8) takes it, in the deferred queue with items 1 and 2.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/proto_actions.rs::{add, set, remove, move_action, edit, list_mut, path_param, action_param, check_action}` | `prototype-commands.ts` `editActions`, `editList`, `pathParam`, `checkAction` |
| `crates/engine/src/cmd/proto_actions.rs::{add_block, set_condition, remove_block, condition_param, default_condition, start_value}` | `prototype-commands.ts` `editActions`, `conditionParam`, `defaultCondition` |

[Property matrix](26-11-24-prototype-actions-parity.html) · [Plan](../planning/26-11-24-prototype-actions.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-actions.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `10f91d4`, native reference `bad07e44` |
| Failing fixtures first | The parity case failed before |
| Full pure suite | 5,593 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 17.2-minute run at `10f91d4` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed in 14.17 seconds, run once after the browser gates of items 2 to 4 (the publication rate window from item 1's second run had to clear) |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,070 nodes/38,688 edges at `10f91d4`; native 28,939/92,127 at `bad07e44`; combined 38,009/129,611. `editActions`, `editList`, `pathParam`, `conditionParam` and `defaultCondition` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-actions.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 4 to 10.
