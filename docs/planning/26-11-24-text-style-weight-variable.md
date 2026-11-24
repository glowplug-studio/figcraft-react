# Delta row 5, item 3: a text style's weight bound to a variable

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `ae4ceba`: [report](../reports/26-11-24-text-style-weight-variable.md), [matrix](../reports/26-11-24-text-style-weight-variable-parity.html), [provenance](../../tests/fixtures/native-text-style-weight-variable.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `57b9cc0` on `prompt/full-figcraft-port`.
- Upstream commits: `ccb33e0b`, `281918e2` (#2174). Ledger item 5.6.
- Files changed: `src/engine/style-definitions.ts`, `style-variables.ts`, `style-commands.ts`, `variable-css-names.ts`, `src/StyleTypography.tsx`, `src/StyleVariablePicker.tsx`; tests `tests/parity/text-style-weight-variable.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-text-style-weight-variable.json` with provenance.
- Next action: none; the item is recorded. Row 5 continues in its row plan.
- Blockers: none.

## Native contract

- **`assets/style_vars.rs`**: a text style takes a Number variable on `fontWeight`. Resolving it, the weight (clamped to 1–1000) names the nearest face (`weight_name`, kept italic when the style is) and sets the `wght` axis, so static and variable fonts both follow. A face name resolved on `fontStyle` clears the style axes (`set_font_style`). Keys resolve in sorted order, so a weight wins in a file carrying both.
- **`cmd/styles.rs::bind_style`**: binding `fontWeight` removes a `fontStyle` binding and the reverse; a colour or string variable on the weight is refused.
- **`assets/token_roles.rs`**: a number bound to a text style's weight is unitless in the CSS export.
- **`ui-egui/src/widgets/style_picker.rs`**: the style editor's weight slot offers number variables beside face names.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `assets/style_vars.rs::{field_type, set_text_field}` | `style-definitions.ts::styleBindingType`, `style-variables.ts::textWithVariable` | Two native scenes |
| `cmd/styles.rs::bind_style` | `style-commands.ts` `style.bind` | The same |
| `assets/token_roles.rs` | `variable-css-names.ts::numberRoles` | Native CSS scene |
| `ui-egui/src/widgets/style_picker.rs` | `StyleTypography.tsx` "Style font weight", `StyleVariablePicker.tsx` (`FONT_WEIGHT`) | Browser |

## Acceptance

- Each native observation matches; all three scenes failed before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
