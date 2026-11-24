# Upstream delta row 5, item 3: a text style's weight bound to a variable

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `ae4ceba`. **This bounded item passes. Four items of row 5, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **The weight takes a number.** `style.bind` accepts a Number variable on a text style's `fontWeight` ([`styleBindingType`](../../src/engine/style-definitions.ts)). Resolved, the weight (clamped to 1–1000) picks the face nearest it, italic kept, and sets the `wght` axis ([`textWithVariable`](../../src/engine/style-variables.ts)), so a layer in Light shows Bold at 700 and one in Dark Regular at 400.
- **Weight and face name replace each other.** Binding one removes the other's binding ([`style-commands.ts`](../../src/engine/style-commands.ts)); a face name clears the style axes, and a weight wins in a file carrying both.
- **CSS.** A variable bound to a style weight exports without a unit ([`numberRoles`](../../src/engine/variable-css-names.ts)): `--weight: 700;`.
- **Style editor.** A "Style font weight" picker offers number variables beside the face menu, which hides while a weight is bound ([`StyleTypography.tsx`](../../src/StyleTypography.tsx)).

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-text-style-weight-variable.json](../../tests/fixtures/native-text-style-weight-variable.json) | Three scenes: a weight across modes, a refused colour variable and a face name replacing it; junk values clamped; the CSS export | Every face, axis, refusal, binding map and CSS line matches. All three failed before (the binding was refused) |
| Browser: the weight picker in the style editor | The bound style saves `fontWeight` and the text draws Bold with `wght` 700 |

Provenance: [a text style's weight bound to a variable](../../tests/fixtures/native-text-style-weight-variable.provenance.md).

## Recorded differences

- **One picker or two.** Native's weight slot opens one picker offering face names and numbers; the port shows the number picker beside the face picker.
- **`.fig`.** Native's `.fig` writer has no weight field yet, and nor does the port's.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/assets/style_vars.rs` | `style-definitions.ts`, `style-variables.ts` |
| `crates/engine/src/cmd/styles.rs::bind_style` | `style-commands.ts` |
| `crates/engine/src/assets/token_roles.rs` | `variable-css-names.ts` |
| `crates/ui-egui/src/widgets/style_picker.rs` | `StyleTypography.tsx`, `StyleVariablePicker.tsx` |

[Property matrix](26-11-24-text-style-weight-variable-parity.html) · [Plan](../planning/26-11-24-text-style-weight-variable.md) · [Parity](../../tests/parity/text-style-weight-variable.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `ae4ceba`, native reference `bad07e44` |
| Failing fixtures first | All three native scenes failed before |
| Full pure suite | 5,575 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 427 cumulative Chromium cases passed in one 17.2-minute run at `ae4ceba` with zero skips, retries, flakes or suite errors: the 426 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 12.87 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,931 nodes/38,175 edges at `ae4ceba`; native 28,939/92,127 at `bad07e44`; combined 37,870/129,107. `textWithVariable`, `styleBindingType`, `numberRoles`, `set_text_field` and `bind_style` verified. |

## Reproduction

```sh
npx vitest run tests/parity/text-style-weight-variable.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "weight takes a number variable" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 5 continues with item 4, variables.
