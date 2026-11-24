# Delta row 5, item 4: variables

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `5e27442`: [report](../reports/26-11-24-variables-duplicate-page-modes.md), [matrix](../reports/26-11-24-variables-duplicate-page-modes-parity.html), [provenance](../../tests/fixtures/native-variables-duplicate-page-modes.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `cfc1271` on `prompt/full-figcraft-port`.
- Upstream commits: `a20415e1`, `9c3949fc`, `8a78214b`, `4313a60f`, `815cbf9f`, `7644de9f`, `70aeeee9`, `92d0ffdc`, `a60cb1a6` (#2082, #2084, #2353, #2215). Ledger item 5.5.
- Files changed: `src/engine/variable-metadata.ts` (`variable.duplicate`), `src/VariableModesPanel.tsx`; tests `tests/parity/variables-duplicate-page-modes.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-variables-duplicate-page-modes.json` with provenance.
- Next action: none; the item is recorded (its variables-panel parts are deferred). Row 5 continues in its row plan.
- Blockers: none.

## Native contract and what this item ports

- **`variable.duplicate`** (`815cbf9f`): an exact id is matched before a name, so an earlier variable named like another's id is not the one copied. Ported.
- **Page variable modes** (`a60cb1a6`, #2215): with nothing selected the Design panel shows the page's Variable modes, a row per multi-mode collection, Auto or a mode, one undo step per pick (`variable.setMode` without layers sets the page's mode). Ported: the port's engine already set the page's mode; its panel now shows with nothing selected.
- **Variables panel** (`a20415e1`, `9c3949fc`, `8a78214b`, `4313a60f`, `7644de9f`, `70aeeee9`, `92d0ffdc`): bulk Edit variables with mixed states, a mixed checkbox's announcement, Duplicate group, and slash-rename nesting with rollback. Not ported here: they need the panel's variable groups and multiple selection, which the port's Local variables panel does not have. They are in the handover's deferred queue (row 19, from upstream delta row 5).

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/cmd/variables.rs` `variable.duplicate` lookup | `variable-metadata.ts` | Native scene |
| `ui-egui/src/panels/right.rs`, `right/paints.rs` page Variable modes | `VariableModesPanel.tsx` (page targets) | Native scene; browser |

## Acceptance

- Both native observations match; the duplicate case failed before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
