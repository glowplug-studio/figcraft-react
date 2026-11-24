# Upstream delta row 5: components, variables and styles

## Execution checkpoint

- Phase: items 1 to 5 complete through Phase 7 at `4f762c3`, `dad7613`, `ae4ceba`, `5e27442` and `ba52a26` ([inherited slot properties](../reports/26-11-24-slot-inherited-properties.md), [the properties an instance lists](../reports/26-11-24-instance-properties.md), [a text style's weight bound to a variable](../reports/26-11-24-text-style-weight-variable.md), [variables](../reports/26-11-24-variables-duplicate-page-modes.md), [the component button's menu](../reports/26-11-24-component-create-set.md)). Row closed on 24 November 2026: items 6 and 7 are carried (the prototype canvas and Dev Mode are not ported yet).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React revision: the row 4 records commit on `prompt/full-figcraft-port`.
- Source queue: row 5 of the [upstream delta queue](26-11-15-upstream-delta.md), range `7bf098d7..bad07e44`, with its commits taken from the [commit ledger](26-11-20-upstream-delta-ledger.md).
- Files in progress: none.
- Native oracle: `$HOME/.cache/figcraft-oracle/project`; `replay` runs command sequences through the pinned engine and observes component, variable and style commands and their receipts.
- Next action: none; the row is closed. Open [delta row 6](26-11-24-delta-row-6-library-links.md).
- Blockers: none. Oracle builds are CPU-heavy; do not run them during a browser gate.

## Why the order

Items that engine commands decide come first, since `replay` observes them: slot resolution, the properties an instance lists, a text style's weight bound to a variable and `variable.duplicate` by exact id. Interface items follow, restating native interface tests: the component button's Create multiple components and Create component set, the variables panel's bulk editing, Duplicate group, slash rename and page modes, and a prototype connection dropped on a sibling variant. The import-cost item changes performance only, and its Code Connect half belongs to Dev Mode, which roadmap row 17 has not ported.

| Item | Ledger | Upstream behaviour | Native files and tests | React files | Status |
|---|---|---|---|---|---|
| 1 | 5.1 | Inherited slot properties resolve by their defining component (`a6d9b74d`, `a66946d1`, `2067a0b5`) | `engine/src/assets/components/sync.rs`; `engine/src/slot_tests.rs` | `component-properties.ts`, component sync | Verified at `4f762c3` with native observations ([plan](26-11-24-slot-inherited-properties.md)) |
| 2 | 5.2 | An instance lists the properties its variant uses; long property names stay on one line (#2022; `14670b99`) | `engine/src/assets/components.rs`, `cmd/component/props.rs`, `format/src/fig/prop_value_tests.rs`; `prop_order_tests.rs` | component properties, `InstancePanel.tsx` | Verified at `dad7613` with native observations ([plan](26-11-24-instance-properties.md)) |
| 3 | 5.6 | Text styles: bind a number variable to the weight (#2174; `ccb33e0b`, `281918e2`) | `engine/src/assets/style_vars.rs`, `token_roles.rs`, `cmd/styles.rs`; `style_vars_tests.rs` | style variables, `SharedStylesPanel.tsx` | Verified at `ae4ceba` with native observations ([plan](26-11-24-text-style-weight-variable.md)) |
| 4 | 5.5 | Variables: bulk Edit variables, Duplicate group, duplicate by exact id, slash rename with rollback, page modes with nothing selected (#2082, #2084, #2353, #2215; nine commits) | `engine/src/cmd/variables.rs`, `ui-egui/src/dialogs/variables_panel.rs`; `variables_editor_tests.rs`, `variables_select_tests.rs`, `a11y_tests.rs` | variable commands, the variables panel | Verified at `5e27442` with native observations ([plan](26-11-24-variables-duplicate-page-modes.md)) |
| 5 | 5.4 | Create multiple components and Create component set in the component button's menu, with refusals (#2088, #2095; `f5a52ea5`, `524ad8b1`, `253e0c3d`, `dda27030`) | `ui-egui/src/panels/right.rs`; `components_behaviour_tests.rs`, `create_multiple_menu_tests.rs` | `ComponentPanel.tsx` | Verified at `ba52a26` with native observations ([plan](26-11-24-component-create-set.md)) |
| 6 | 5.3 | A connection dropped on a sibling variant creates Change to; grouped sets take none (#2158, #2161; `5c500252`, `36cd59da`, `499717d6`) | `ui-egui/src/canvas/proto_canvas.rs`; `proto_variant_connect_tests.rs` | the prototype canvas | Verified at `04531a3` with the prototype canvas, roadmap row 15 item 9 ([report](../reports/26-11-25-canvas-connections.md)) |
| 7 | 5.7 | Import cost: each main's layer paths worked out once; `codeConnect.import` indexes components by name (`a8e34e75`, `6e9582c0`) | `engine/src/assets/components/rebase.rs`, `cmd/file/load.rs`, `dev/code_connect.rs` | the instance rebase on import | Performance only with no port counterpart; the Code Connect half waits for Dev Mode (roadmap row 17; [deferred queue](26-11-07-full-port-resume.md#deferred-tests-and-reviews)) |

## Acceptance per item

Native observations recorded with provenance where `replay` reaches the behaviour, restated native tests where it does not; each new case fails without its change; the full pure suite, strict types, both builds, the cumulative browser gate, provider integrations once, zero fixture counts and the local graph pass before the item is recorded.
