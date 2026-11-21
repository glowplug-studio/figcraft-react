# Native observations for lists (upstream a4e33077, bb480bdf, 4e9b414c, b190e675, 7c3f9ce7, b8f05d19)

Data: [native-lists.json](native-lists.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Eleven typing sequences, ten exports and one re-observation. Files travel as base64 in the receipts, so nothing is written to disk.

Each typing sequence creates a text (layer 2), opens it with `text.edit.begin` (everything selected), types with `text.edit.insert` one piece at a time, ends with `text.edit.end` and reads `node.get`. `text` holds the list fields of that receipt: `name`, `characters`, `listStyle`, `lineTypes`, `listStartOffsets`, `lineIndentations`.

| Sequence | Typed | Result |
|---|---|---|
| a list typed at 5 | `5.`, space, `a`, Enter, `b`, Enter, `c` | Three numbered items; starts 4, 0, 0 |
| a list typed at 5 and split by Backspace at the start of b | The same, then `text.edit.caret {index: 2}` and `text.edit.key Backspace` | Numbered, plain, numbered; starts 4, 0, 0, so `c` reads 1 |
| a list typed at 1 and split | The same from `1.` | Numbered, plain, numbered; no starts |
| typed 0. | `0.`, space, `a` | Text `0. a` |
| typed 12a. | `12a.`, space, `a` | Text |
| typed 2) | `2)`, space, `a` | Text |
| typed 1) | `1)`, space, `a`, Enter, `b` | A numbered list |
| typed 9999. | `9999.`, space, `a`, Enter, `b` | Starts 9998, 0 |
| typed 10000. | `10000.`, space, `a` | Text |
| typed 7. in a bullet item | `-`, space, `a`, Enter, `7.`, space, `b` | A bulleted list whose second item reads `7. b` |
| typed 3. after a plain paragraph | `p`, Enter, `3.`, space, `a`, Enter, `b` | Plain, numbered, numbered; starts 0, 2, 0 |

| Export | Built by | Export warnings | After reopening |
|---|---|---|---|
| a list typed at 5 | The first sequence | None | Starts 4, 0, 0: the file has 4 on every line and the reader keeps it where the list starts counting |
| a list typed at 5 and split by Backspace at the start of b | The second sequence | None | Numbered, plain, numbered; starts 4, 0, 0 |
| typed 3. after a plain paragraph | The last sequence | None | Starts 0, 2, 0 |
| the four fields | `node.set` with `listSpacing: 8`, `hangingPunctuation`, `hangingList` and `leadingTrim: "capHeight"` | None | All four kept |
| features | `node.set {features: {smcp: true}}` | `OpenType features were left out` | No features |
| an instance that keeps its main's four fields | A frame with such a text made a component, and an instance | None | Both texts have the four |
| an instance override back to the defaults | The instance's text (layer 5) set back to the defaults | None | The main keeps the four; the instance has none |
| an instance override of one field | The instance's `listSpacing` set to 3 | None | The instance has 3 and the other three |
| each field alone: list spacing | `listSpacing: 2.5` | None | 2.5 |
| each field alone: vertical trim | `leadingTrim: "capHeight"` | None | Kept |

Each export holds the texts' list fields (`texts`), the drawing as native saved it (`source`), native's `.fig` (`fig`) with its warnings, and the `.fig` opened natively again by a second run (`file.open {data, name: "Exported.fig"}`, `node.get` for layers 3 to 7, `file.saveAs {data: true}`): its warnings, the texts' list fields (`reopenedTexts`) and the saved document (`reopened`).

`repinned` holds one drawing of the older REST corpus, "text layout": its archive in [native-rest-documents.json](native-rest-documents.json) opened natively (`file.open {data, name: "Source.figcraft"}`), exported as `.fig` and reopened as above. The corpus's own export of it, in `native-fig-imports.zip`, was written before the change and left the four fields out. At this revision the export warns `nested list levels were written as the first level` and `OpenType features were left out`, and the reopened texts keep the four fields. The corpus file is unchanged.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`. A typing sequence is its `commands`. For an export, append `file.saveAs {data: true}` and `file.export {format: "fig"}` where the case's `commands` do not already end with them; for the reopening, pass the `data` of the export receipt to `file.open` as above.
