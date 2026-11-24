# Upstream delta row 3, item 7: a wrap style per paragraph and in text styles

> **Draft.** The implementation is committed at `f1038dd` on the local branch `prompt/full-figcraft-port-pending`. The cumulative browser gate has not passed yet, so the tokens in capitals below (`IMPLEMENTATION_COMMIT` and the result tokens in the final verification table) are placeholders, and the bold pass statement and the results that depend on the gate are expectations, not results. The property matrix link resolves only once the matrix is generated after the gate. Fill them and remove this note when the gate passes; see the [handover](../planning/26-11-07-full-port-resume.md#continue-from-here).

22 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `IMPLEMENTATION_COMMIT`. **This bounded item passes. Eleven items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #1827 (`136ca4cd`, with `d14c637d`, `7e2752d5`, `071cc86b`, `654eb205`) adds the paragraph and text-style levels of the wrap style to the layer level the port had.

- **A paragraph's own style.** A paragraph may carry its own wrap style ([text-data.ts](../../src/engine/text-data.ts)); without one it follows the layer's. [text-ranges.ts](../../src/engine/text-ranges.ts) holds the two setters: the layer level clears every paragraph's own, and a paragraph set to the layer's value has no override.
- **Commands.** `node.set wrapStyle` or `textWrap` with `start` or `end` sets the touched paragraphs ([text-properties.ts](../../src/engine/text-properties.ts)); without, the layer. `text.wrapStyle` sets the selected paragraphs while editing and the layer otherwise ([text-format-commands.ts](../../src/engine/text-format-commands.ts)). Before, both always set the layer.
- **Reading.** `node.get` gives `wrapStyle` when the paragraphs agree on a style other than auto and `lineWrapStyles` when they differ ([inspect-text.ts](../../src/engine/inspect-text.ts)). CSS gets `text-wrap` only when they agree ([layer-css.ts](../../src/engine/layer-css.ts)).
- **Text styles.** A text style's paragraph part carries `wrap_style` ([shared-styles.ts](../../src/engine/shared-styles.ts)): taken from a text ([style-definitions.ts](../../src/engine/style-definitions.ts)), applied to a layer or a range, followed on redefinition, and checked when deciding whether a text still shows its style ([style-application.ts](../../src/engine/style-application.ts)). A file whose style has one now opens; before, it was refused.
- **Layout.** [text-line-breaker.ts](../../src/engine/text-line-breaker.ts) breaks each paragraph by its own style.
- **Control.** Text wrap in the [Typography panel](../../src/TypographyPanel.tsx) shows the selected paragraphs' style while editing, Mixed when they differ, and runs `text.wrapStyle`.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-wrap-style-paragraphs.json](../../tests/fixtures/native-wrap-style-paragraphs.json), `cases` | Seven command sequences, 86 steps, three of them refused | All seven match in what is compared of every receipt; each refusal is refused with native's wording and changes nothing. All seven failed before the change |
| The same file, `saved` | Two documents native saved | Both open to the same texts the port builds from the same commands. Both failed before: one on the paragraphs, one refused for the style's `wrap_style` |
| The same file, `layout` | Where each paragraph's second line starts in seven states of one text | All seven match |
| The same file, `css` | The `text-wrap` lines of native's CSS in six states of one text | All six match |
| The same file, `repinned` | Two older sequences run again at the pin | Both match |

[Provenance and reproduction](../../tests/fixtures/native-wrap-style-paragraphs.provenance.md).

## Earlier expectations changed

Two older native records set a wrap style on a range and were made before this upstream change: sequence 129 of `native-text-format-commands.json` and case 223 of `native-typography.json`. Both expected the layer's `wrapStyle`. Run again at `bad07e44` with the five packaged fonts loaded, native lists the paragraphs' styles; every other value equals the old record, and a third sequence run as a control equals its record in full. The two tests compare those cases with the new observations; the older fixture files are unchanged.

## Recorded differences

- **The style editor's row.** Native shows a text style's wrap style as a read-only row in the style editor. The port's style editor has no paragraph rows; this belongs to the interface row.
- **.fig files.** Neither engine writes or reads a paragraph's or a style's wrap style in `.fig` files; upstream leaves that for a later change.
- **Line starts.** The layout comparison is where each paragraph's second line starts, read natively with the Down key. Glyph positions were not compared in this slice.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/text.rs` `ParaList::wrap`, `para_wrap_style`, `set_wrap_style`, `set_para_wrap_styles`, `common_wrap_style` | `text-data.ts` `ParaList.wrap`; `text-ranges.ts::{paraWrapStyle, paraWrapStyles, setWrapStyle, setParaWrapStyles, commonWrapStyle}` |
| `crates/engine/src/cmd/props.rs` `wrapStyle` | `text-properties.ts::{applyProperty, wrapStyleValue}` |
| `crates/engine/src/cmd/text.rs::set_wrap_style` | `text-format-commands.ts` `wrapStyle` |
| `crates/engine/src/automation/inspect.rs` | `inspect-text.ts`, `inspect.ts` |
| `crates/engine/src/dev/codegen/css.rs` | `layer-css.ts` |
| `crates/doc/src/text.rs::{paragraph_style, take_paragraph_style, take_paragraph_style_in, shows_paragraph_style_in}`; `crates/engine/src/cmd/styles.rs` | `shared-styles.ts::readParagraph`; `style-definitions.ts::{nodeDefinition, explicitDefinition}`; `style-application.ts::{applyParagraph, showsParagraph}` |
| `crates/text/src/layout.rs` | `text-line-breaker.ts::wrap` |
| `crates/ui-egui/src/panels/typography/fields.rs` | `TypographyPanel.tsx` |

[Property matrix](26-11-22-wrap-style-paragraphs-parity.html) · [Plan](../planning/26-11-22-wrap-style-paragraphs.md) · [Wrap style parity](../../tests/parity/wrap-style-paragraphs.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `IMPLEMENTATION_COMMIT`, native reference `bad07e44` |
| Failing fixtures first | All seven sequences and both saved files failed before the change |
| Older expectations | Two, described above, changed on native observations at the pin |
| Full pure suite | PURE_COUNT passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | FULL_BROWSER_RESULT |
| Real local provider integrations | PROVIDER_RESULT |
| Fixture cleanup | CLEANUP_RESULT |
| Schema / hosted | No change; no hosted call |
| Local graph | GRAPH_RESULT |

## Reproduction

```sh
npx vitest run tests/parity/wrap-style-paragraphs.test.ts tests/parity/text-format-commands.test.ts tests/parity/text-node.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The style editor's read-only row, above.
- Native's `inspect.code` belongs to Dev Mode and is not a port command; its `text-wrap` lines are compared with the port's layer CSS function directly.
- Row 3 continues with item 8, export settings and colour profile notes.
