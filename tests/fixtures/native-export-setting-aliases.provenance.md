# Native observations for export settings read and written back (upstream 6c3ac0c5, 3f39154a)

Data: [native-export-setting-aliases.json](native-export-setting-aliases.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 22 November 2026 by the disposable `replay` executable built against the pinned native source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- Environment: the `rust:latest` Docker image, `rustc 1.99.1`.

## What the file holds

Eight command sequences and one re-observation. Each sequence draws one rectangle (layer 2); `exports` keeps what each `node.get` returns as the layer's export settings.

| Sequence | What it shows |
|---|---|
| node.set takes back what node.get returns | A setting made by `export.add` with every two-word field off its default; `node.set` with an empty list clears it; `node.set` with the list `node.get` returned stores it again unchanged |
| node.set takes the snake_case spellings | The same setting given with snake_case keys and a nested `print` is stored the same |
| one snake_case key at a time | Each of the seven top-level aliases alone sets its field |
| the print settings' snake_case keys | `crop_marks` and `bleed_marks` inside `print` |
| both spellings of one key | `contentsOnly: false` with `contents_only: true` stores the default |
| an unknown key and the flat print keys | An unknown key is ignored; `bleed`, `cropMarks` and `crop_marks` at the top level of a `node.set` setting are ignored |
| export.add with snake_case keys | `export.add` ignores the snake_case names |
| both spellings, the snake_case one first | The snake_case value wins whatever the order, at the top level and inside `print`; a key with a leading capital is ignored |

`repinned` holds one sequence of the older [native-export-settings.json](native-export-settings.json), "raw property defaults and options", which gives `colorProfile`, `includeBoundingBox` and `print.cropMarks` to `node.set`. Run again at this revision with `file.saveAs {data: true}` appended, its `node.get` returns all three, and the saved `document.json` holds them (`wire`); the older record, made before the change, had them dropped. The older fixture file is unchanged.

## Reproduction outside the port runtime

Run the `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md) (source SHA-256 `cfe5fc0857634ef9db63476452a9234c9864bd1ca5ad0de6937af6b1721b117a`) with `[{"name", "commands": [[command, params], ...]}]`, which is each case's `name` and `commands`. For the re-observation, run the older fixture's commands and append `file.saveAs {data: true}`; the saved file is a ZIP whose `document.json` holds layer 2's `exports`.
