# Roadmap row 15, item 8b: the interaction editor

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `a6e97bc`: [report](../reports/26-11-25-interaction-editor.md), [matrix](../reports/26-11-25-interaction-editor-parity.html).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `6e8e385` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/InteractionEditor.tsx` (new); `src/PrototypePanel.tsx` (an interaction opens its editor; a new one opens on Add); `src/engine/prototype-summaries.ts` (`actionKinds`, `actionOf`, `variantsFor`, `valueJson`, `wireAction`, `animates`, `unavailableAction`); `src/engine/prototype-commands.ts` (`startValue`, `defaultCondition` exported); one case in `tests/e2e/preview.spec.ts`, and the item 8a case scoped to the interactions list.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract

- **`proto_panel.rs::editor_popover`, `trigger_rows`**: the trigger (ten kinds, keeping a key or delay already set), a mouse trigger's delay and an after-delay's milliseconds (0 to 600,000), a key recorded from the next key pressed with its modifiers (Escape cancels when a key is set), or a controller button.
- **`proto_editor.rs`**: the action list (one action shown open; more each open or summarised, moved up and down, removed but for an interaction's last), "Add action" with native's defaults and its notices when a kind cannot be made; conditional blocks (If, Else if, Else, each removable, "Else if" and "Else" added) with conditions typed and checked; set variable with its variable and a fixed value or an expression, checked against the variable's type with native's messages.
- **`proto_panel.rs::action_fields`**: destinations (navigation targets, frames, variants, layers of the frame to scroll in), Preserve scroll, the link and Open in new tab, an overlay's position, anchor, manual offset, close on outside and background with its opacity, Scroll to's offset, a set variable mode's collection and mode.
- **`animation_rows`, `custom_easing_fields`**: the transition with its direction, the easing (eleven curves and springs, custom bezier and spring, keeping custom values when re-picked), the duration (1 to 10,000 ms) or a spring's settle time, and a custom curve's or spring's settings; shown only when an action animates.

## The port

`InteractionEditor.tsx` follows those rows with the port's form controls and runs the same commands (`proto.interaction.set`, `proto.action.*`, `proto.conditional.*`), so every edit is one undo step as in native. Two parts are recorded as differences: conditions are typed as expressions (native also offers a variable, operator and value builder for simple ones), and the easing curve has no animated preview.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `proto_panel.rs::{editor_popover, trigger_rows, action_fields, animation_rows, custom_easing_fields}` | `InteractionEditor.tsx` | Browser case |
| `proto_editor.rs::{action_list, action_item, conditional_blocks, set_variable_fields, expr_field}` | `InteractionEditor.tsx` | Browser case |
| `proto_panel.rs::{action_of, variants_for, value_json, animates}`, `proto_editor.rs::unavailable` | `prototype-summaries.ts` | Browser case |

## Acceptance

- The browser case sets an after-delay trigger, turns the action into a conditional with a typed condition, adds actions to its if and else blocks, adds a set variable whose bad expression is refused with native's message and whose good one is kept, and sets a push upwards with a gentle spring; the saved interaction matches what native's commands store. It failed before (no editor).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
