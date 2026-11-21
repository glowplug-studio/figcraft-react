# Native observations for text on a path in .fig export (upstream 88b63d1e, a243f0b8, 193c3a35)

Data: [native-fig-text-path-export.json](native-fig-text-path-export.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 21 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Eight export cases, three instance cases and six re-observations. Files travel as base64 in the receipts, so nothing is written to disk.

Each export case creates a text (layer 2) and a path layer (layer 3), puts the text on the path with `text.onPath {text: 2, path: 3}`, and for some sets `text.pathOptions`.

| Case | Path and options | Export | After reopening |
|---|---|---|---|
| a straight path | `M0 0 L200 0` | No warning | On the same path, start 0 |
| a curve | `M0 100 C50 0 150 0 200 100` | No warning | On the same path |
| a start a quarter along and flipped | The curve, `start: 0.25, flip: true` | No warning | Flipped, start 0.24999998530690415 |
| a start on the second segment | `M0 0 L100 0 L100 100`, `start: 0.75` | No warning | Start 0.75 |
| a quadratic curve | `M0 100 Q100 0 200 100` | No warning | The raised cubic with 32-bit control points |
| a closed path | An ellipse, `start: 0.4` | No warning | The cycle begins at the segment the text starts on; start 0.15000000385516724 |
| a path of two parts | `M0 0 L100 0 M0 50 L100 50` | `the parts of a text's path after the first were left out` | On the first part only |
| text of two lines | The straight path, text `One` and `Two` on two lines | `text on a path with more than one line was written as plain text` | Plain text |

Each case holds the text's path as `node.get` reads it (`textPath`), the drawing as native saved it (`source`), native's `.fig` (`fig`) with its warnings, and the `.fig` opened natively again by a second run (`file.open {data, name: "Exported.fig"}`, `node.get {id: 3}`, `file.saveAs {data: true}`): its warnings, the text's path and the saved document (`reopened`).

The instance cases build a frame holding a text and a curve, put the text on the curve, make the frame a component (`component.create`) and place an instance (`instance.create`), whose text is layer 6.

| Instance case | Change | Export warnings | Warnings on reopening |
|---|---|---|---|
| an instance of a component whose text is on a path | None | None | None |
| an instance text of two lines on its main's path | `text.set {id: 6}` to two lines | `an instance's text of more than one line stays on its main component's text path in the file, as an override can't take it off` | `text path contains multiple lines; text imports off its path` |
| an instance text of one line where the main's two lines stay plain text | The main's text has two lines; the instance's is set to one | `text on a path with more than one line was written as plain text`, then `text on a path in an instance but not in its main component, or the other way round, was written as the main has it` | None |

A fourth sequence tried `text.onPath` on an instance's own layers where the main's text is not on a path. Native refuses it (`layers can't be added, removed or reordered inside the instance`), so that direction cannot be built by commands and is not in the file.

`repinned` holds six drawings of the older text corpus (`closed loop`, `decorated`, `forward line`, `oriented chain`, `reverse line`, `stretched cubic`; each `<name>.figcraft` in `native-fig-text.zip`), opened natively (`file.open {data, name: "Source.figcraft"}`), exported as `.fig` and reopened as above. The corpus's own exports of them, in `native-fig-export.zip`, were written before the change with the warning `text on a path was written as plain text`. At this revision all six export without a warning; `decorated` reopens with `text path underline or strikethrough decoration is not rendered`. The other 26 drawings of that corpus export as before and were not re-recorded. The corpus files are unchanged.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`. For an export case the commands are the case's `commands`; for a reopening, pass the `data` of the export receipt to `file.open` as above.
