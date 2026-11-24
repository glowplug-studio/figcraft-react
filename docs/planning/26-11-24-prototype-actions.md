# Roadmap row 15, item 3: action and conditional-block commands

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `10f91d4`: [report](../reports/26-11-24-prototype-actions.md), [matrix](../reports/26-11-24-prototype-actions-parity.html), [provenance](../../tests/fixtures/native-prototype-actions.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `abe7345` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-commands.ts` (`proto.action.{add,set,remove,move}`, `proto.conditional.{addBlock,setCondition,removeBlock}`); test `tests/parity/prototype-actions.test.ts`; fixture `tests/fixtures/native-prototype-actions.json` with provenance.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract (`engine/src/cmd/proto_actions.rs`)

- An action is addressed by a `path`: `[i]` is the interaction's action `i`, `[i, b, j]` action `j` of block `b` of conditional action `i`, and so on. A path is a list of an odd number of whole numbers below a million, at most 33 long.
- **`proto.action.add`** inserts at `path` (default: after the last action), one past a list's end at most, 200 actions in a list at most; **`set`** replaces, **`remove`** removes (an interaction keeps one action), **`move`** reorders in the same list and answers the new path. A new action has its expression text read and names stored as ids, a set variable must name an existing variable its expression fits, conditions give true or false, destinations exist.
- **`proto.conditional.addBlock`** adds an else if before an else (or at the end), or the else (`else: true`, refused with a condition or when there is one already); its condition is `expression` text, `condition` JSON, or by default the first boolean variable (else the first variable) equal to its value, or `true` without variables. 50 blocks at most. **`setCondition`** replaces a block's condition; **`removeBlock`** removes a block, and the whole conditional action when no if is left first, answering `removedAction`.
- Each command edits interaction `index` of every target that has it, all or nothing; none having it is refused.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/proto_actions.rs::{add, set, remove, move_action, edit, list_mut, path_param, action_param, check_action}` | `prototype-commands.ts` `editActions`, `editList`, `pathParam`, `checkAction` | Native observations |
| `cmd/proto_actions.rs::{add_block, set_condition, remove_block, condition_param, default_condition, start_value}` | `prototype-commands.ts` `editActions`, `conditionParam`, `defaultCondition` | Native observations |

## Acceptance

- 62 native steps match: receipts, 27 errors and the stored actions at three saves. The test failed before.
- No browser case: the interaction editor (item 7) takes it, in the deferred queue.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
