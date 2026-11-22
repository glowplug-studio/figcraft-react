# Native observations for a wrap style per paragraph and in text styles (upstream 136ca4cd, d14c637d, 7e2752d5)

Data: [native-wrap-style-paragraphs.json](native-wrap-style-paragraphs.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 22 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Seven command sequences, one layout sequence, one CSS sequence and two re-observations.

Each case under `cases` runs its `commands` in a new document. `receipts` keeps, per command: for `node.get` the text's `characters`, `wrapStyle`, `lineWrapStyles`, `textStyleRanges` and linked text style; for `style.list` each style's `id`, `name` and `paragraph` part; for `style.create` the id; for a refused command its error; nothing for the rest. `saved` is the document as native saved it where the sequence ends with `file.saveAs {data: true}`.

| Sequence | What it shows |
|---|---|
| a paragraph's own wrap style and the layer level | `node.set wrapStyle` with a range sets that paragraph: `lineWrapStyles` reads auto, balance, pretty. `text.wrapStyle` without editing sets the layer: `wrapStyle` balance and no list. Undo brings the list back |
| a trailing empty paragraph | A range after the final newline sets the empty last paragraph, which is listed. Every paragraph the same gives the one key; auto gives neither |
| the edited paragraphs while editing | `text.wrapStyle` while editing sets the caret's paragraph. Enter inside a balanced paragraph carries the style to the new one. A bad value is refused and changes nothing |
| a style equal to the layer's is no override | Under a balanced layer, balance on a paragraph changes nothing; auto on it gives auto, balance; balance again folds back |
| a range across paragraphs and the textWrap spelling | `textWrap` is the same key; a range touches every paragraph it reaches; `start` alone runs to the end and `end` alone from the start |
| text styles carry the wrap style | A style made from a balanced text has `paragraph.wrap_style` balance. Applying it sets the layer; redefining it moves a linked text; setting the text to auto unlinks it; applying to a range sets that paragraph's own. A value's `wrapStyle` makes a style; `zigzag` and a number are refused |
| a style from a layer whose paragraphs differ | A balanced paragraph before an empty auto one gives no paragraph part; two paragraphs both balanced give balance; balance over a pretty layer gives the layer's pretty |

`layout` is one text of two equal paragraphs, `aaa bbb ccc ddd eee`, at 16 pixels in a box 130 wide, with Inter Regular loaded from `fonts/inter/Inter-Regular.ttf` by `text.loadFont {data}` before the text is made (the font's bytes are not in the fixture). After each step's commands the probe named in the file reads where each paragraph's second line starts: `text.edit.begin` at the paragraph's start, `text.edit.key Down`, `text.edit.selection`, `text.edit.end`.

| Step | Second line starts | `node.get` |
|---|---|---|
| auto | 16, 36 | Neither key |
| the second paragraph balanced | 16, 32 | auto, balance |
| the first paragraph pretty, set while editing | 12, 32 | pretty, balance |
| the layer balanced | 12, 32 | `wrapStyle` balance |
| the first paragraph back to auto under a balanced layer | 16, 32 | auto, balance |
| the layer pretty | 12, 32 | `wrapStyle` pretty |
| the layer auto | 16, 36 | Neither key |

`css` is one text of two paragraphs, `one` and `two`. After each `inspect.code {id: 2}` the fixture keeps the lines of the returned CSS that name `text-wrap`: none at auto; none with one paragraph balanced; `text-wrap: balance;` with both balanced as their own; `text-wrap: pretty;` with the layer pretty; none with the second back to auto; none at auto.

`repinned` holds two sequences of older fixtures that set a wrap style on a range: index 129 of [native-text-format-commands.json](native-text-format-commands.json) (`text.wrapStyle` while characters 1 to 5 are selected) and case 223 of [native-typography.json](native-typography.json) (`textWrap` with `end: 4`). Both were run again at this revision on the text those fixtures use, with the five font files under `fonts/` loaded by `text.loadFont`. Their `node.get` now lists `lineWrapStyles` pretty, auto where the older records, made before the change, had `wrapStyle` pretty; case 223 also lists `lineTypes` and `lineIndentations`, as a text with per-paragraph values does. Every other value equals the older record, and a third sequence run beside them as a control (index 214, which sets the layer) equals its older record in full. The older fixture files are unchanged.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`. A case is its `commands`. For the layout sequence, prepend `text.loadFont {data}` with the base64 of the named font file, run `layout.setup`, and after each step's commands run the probe for carets 0 and 20. For a re-observation, load the five font files, create the text `A🙂bc` and `ქართული` on two lines, and run the older fixture's commands with `id: 2`.
