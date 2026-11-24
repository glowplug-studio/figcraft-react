# Upstream delta row 5, item 4: variables

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `5e27442`. **This bounded item passes for the parts the port can take; the variables-panel parts are carried to the deferred queue. Three items of row 5, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **Duplicate by exact id.** `variable.duplicate` matches an exact id before a name ([`variable-metadata.ts`](../../src/engine/variable-metadata.ts)), so an earlier variable named like another's id is not the one copied.
- **The page's variable modes.** With nothing selected the Design panel's Variable modes section targets the page ([`VariableModesPanel.tsx`](../../src/VariableModesPanel.tsx)): a row per multi-mode collection, Auto or a mode, one undo step per pick. Before, the section showed only for selected frames.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-variables-duplicate-page-modes.json](../../tests/fixtures/native-variables-duplicate-page-modes.json) | The native exact-id duplicate test; a page mode set with nothing selected | Both match; the duplicate case failed before (it copied the earlier variable named like the id) |
| Browser: a Theme (Light, Dark) and a one-mode collection, nothing selected | The Theme row shows Auto (Light) and no row shows for the one-mode collection; Dark saves on the page and undoes in one step |

Provenance: [variables](../../tests/fixtures/native-variables-duplicate-page-modes.provenance.md).

## Carried to the deferred queue

Bulk Edit variables with mixed states and the mixed checkbox's announcement, Duplicate group, and a group renamed to a slash path nesting with rollback all act on the variables panel's groups and multiple selection, which the port's flat, one-at-a-time Local variables panel does not have. They are recorded in the handover's deferred queue (row 19, from upstream delta row 5) with their native tests.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/variables.rs` `variable.duplicate` | `variable-metadata.ts` |
| `crates/ui-egui/src/panels/right.rs` page Variable modes | `VariableModesPanel.tsx` |
| `crates/ui-egui/src/dialogs/variables_panel.rs` bulk edit, Duplicate group, group rename | None yet (deferred) |

[Property matrix](26-11-24-variables-duplicate-page-modes-parity.html) · [Plan](../planning/26-11-24-variables-duplicate-page-modes.md) · [Parity](../../tests/parity/variables-duplicate-page-modes.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `5e27442`, native reference `bad07e44` |
| Failing fixtures first | The duplicate case and the browser case failed before |
| Full pure suite | 5,577 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 428 cumulative Chromium cases passed in one 17.1-minute run at `5e27442` with zero skips, retries, flakes or suite errors: the 427 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 14.43 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,932 nodes/38,178 edges at `5e27442`; native 28,939/92,127 at `bad07e44`; combined 37,871/129,110. `VariableModesPanel`, `setVariableMode`, `layerModes`, `duplicate` and `page_section` verified. |

## Reproduction

```sh
npx vitest run tests/parity/variables-duplicate-page-modes.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "page's variable modes" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- The deferred variables-panel changes above.
- Row 5 continues with item 5, the component button's menu.
