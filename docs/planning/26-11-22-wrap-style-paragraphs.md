# Delta row 3, item 7: a wrap style per paragraph and in text styles

## Execution checkpoint

- Coordinator review, 24 November: 5,498 pure tests pass, strict library/test/host types and both production builds pass, and the two focused Chromium workflows pass. The cumulative 410-case browser gate has not yet passed (the second attempt's session was lost); provider/cleanup/final graph verification are still pending. The new archive aliases and wrap creation fixtures are documented below.

- Phase: Phase 6 on 22 November 2026: implemented and committed at `f1038dd` on the local branch `prompt/full-figcraft-port-pending`. The focused and full pure suites, strict types, both builds and the new browser case pass. The cumulative browser gate has not passed: two runs failed on timeouts in unrelated cases while the machine was short of memory (see the handover's pending note).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `a99608c` on `prompt/full-figcraft-port`.
- Upstream commits: `136ca4cd` (#1827), `d14c637d` and `7e2752d5` (#2094 review), `071cc86b`, `654eb205`. Ledger item 3.9.
- Files changed: `src/engine/text-data.ts`, `text-ranges.ts`, `text-properties.ts`, `text-format-commands.ts`, `inspect-text.ts`, `inspect.ts`, `layer-css.ts`, `text-line-breaker.ts`, `shared-styles.ts`, `style-definitions.ts`, `style-application.ts`, `src/TypographyPanel.tsx`; tests `tests/parity/wrap-style-paragraphs.test.ts` (new), `tests/parity/text-format-commands.test.ts`, `tests/parity/text-node.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-wrap-style-paragraphs.json` and its provenance.
- Next action: run the cumulative browser gate once, then the provider integrations, the graph refresh, the report and the records, and fast-forward the port branch.
- Blockers: none.

## Native contract

A wrap style applies at three levels: the text layer, a paragraph, a text style.

- **Model.** A paragraph may carry its own wrap style (`ParaList::wrap`); without one it follows the layer's (`para_wrap_style`). Setting the layer's clears every paragraph's own (`set_wrap_style`). Setting a paragraph's to the layer's value is no override (`set_para_wrap_styles`). A file from before the change has none. A new paragraph made by Enter carries the paragraph's own style.
- **Commands.** `node.set wrapStyle` (or `textWrap`) with `start` or `end` sets the paragraphs those characters touch; without, the layer. `text.wrapStyle` sets the selected paragraphs while editing and the layer otherwise. A bad value is refused as `wrapStyle: auto|balance|pretty`.
- **Reading.** `node.get` gives `wrapStyle` when every paragraph has the same style other than auto, and `lineWrapStyles`, one per paragraph, when they differ; an empty paragraph after a final newline counts. CSS gets one `text-wrap` only when the paragraphs agree.
- **Text styles.** A text style's paragraph part carries `wrap_style`. A style made from a text takes the style its paragraphs share, else the layer's. Applying it to a layer sets the layer's; to a range, the touched paragraphs' own. A linked text follows a redefinition, and a text whose wrap style no longer shows the style's is unlinked. A definition given as a value takes `wrapStyle`, `textWrap` or `wrap_style`.
- **Layout.** Each paragraph breaks by its own wrap style.
- **Control.** The Wrap style control shows the selected paragraphs' style while editing, Mixed when they differ, and runs `text.wrapStyle`.

## What the port had

The layer level only: one `wrapStyle` for the text, set by `node.set` and `text.wrapStyle` whatever the range or editing state. Text styles carried no wrap style, and a file whose style had one was refused on opening.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/text.rs` `ParaList::wrap`, `para_wrap_style`, `set_wrap_style`, `set_para_wrap_styles`, `common_wrap_style` | `text-data.ts` `ParaList.wrap`; `text-ranges.ts::{paraWrapStyle, paraWrapStyles, setWrapStyle, setParaWrapStyles, commonWrapStyle}` | Seven native command sequences |
| `engine/src/cmd/props.rs` `wrapStyle` with a range | `text-properties.ts` | The same |
| `engine/src/cmd/text.rs` `text.wrapStyle` | `text-format-commands.ts` | The sequence that edits; the browser workflow |
| `engine/src/automation/inspect.rs` `lineWrapStyles` | `inspect-text.ts`, `inspect.ts` | Every `node.get` in the sequences |
| `engine/src/dev/codegen/css.rs` | `layer-css.ts` | The `text-wrap` lines of native's `inspect.code` in six states |
| `doc/src/text.rs::paragraph_style`, `take_paragraph_style`, `take_paragraph_style_in`, `shows_paragraph_style_in`; `cmd/styles.rs` | `shared-styles.ts`, `style-definitions.ts`, `style-application.ts` | Two native style sequences and the files native saved |
| `text/src/layout.rs` per-paragraph break style | `text-line-breaker.ts` | Native line starts in seven states |
| `ui-egui/src/panels/typography/fields.rs` | `TypographyPanel.tsx` | The browser workflow |

## Hazards and known differences

- **Older comparisons.** Two older sequences set a wrap style on a range and were recorded before the change. They were run again at the pin with the five packaged fonts loaded; every other value of their `node.get` equals the old record, which checks the setup, and the two older tests compare those cases with the new observations.
- **The style editor's row.** Native lists a text style's wrap style in a read-only row of the style editor. The port's style editor shows no paragraph rows at all; that belongs to the interface row.
- **.fig files.** As upstream says, the wrap styles are not written to or read from `.fig` files.
- **Line starts, not glyphs.** Native's lines were read with the Down key from each paragraph's start, in Inter Regular; the comparison is where each paragraph's second line starts.

## Acceptance

- Seven native command sequences match receipt for receipt in what is compared, refusals included.
- Two files native saved open to the same texts the port builds from the same commands.
- Native's line starts match in seven states of one text.
- The two older sequences match their observations at the pin.
- A signed-in browser workflow sets the edited paragraph's style while editing and the layer's otherwise.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.

## Review on 24 November 2026

The pinned native replay and three focused React cases agree on creating a text style while editing. A mixed selection takes the layer wrap as its style definition, then the new style propagates in the same native transaction and sets that wrap on the touched paragraphs. A selection contained in one balanced paragraph keeps that wrap and links only the selected characters. The review initially inferred from `cmd/styles.rs::create` that a mixed selection kept its overrides. The complete command also runs `derived.rs::normalize`, which propagates the new style and replaces them. The product code matches the observed result. See the [replay provenance](../../tests/fixtures/native-wrap-style-creation.provenance.md) and `npm test -- tests/parity/wrap-style-creation.test.ts --maxWorkers=1`.
