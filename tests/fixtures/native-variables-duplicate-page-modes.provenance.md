# Native observations for variable.duplicate by id and the page's variable modes (upstream 815cbf9f, a60cb1a6)

Data: [native-variables-duplicate-page-modes.json](native-variables-duplicate-page-modes.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

| Case | Native result |
|---|---|
| `duplicate`: native `variables_editor_tests::duplicate_by_id_copies_that_variable_even_when_an_earlier_one_is_named_like_its_id` (Tokens with space/sm, space/md and brand; space/sm renamed to brand's id; then `variable.duplicate` of that id) | The copy is VariableID:4, "brand copy": the exact id wins over the earlier variable named like it |
| `pageModes`: a Theme collection (Light, Dark), nothing selected, `variable.setMode` with no layers to Dark | The saved file's page carries the Dark mode for Theme |

Native `page_variable_modes_tests` drives the Page section's Variable modes with nothing selected (a row per multi-mode collection, Auto or a mode, one undo step per pick, no row for a one-mode collection); the port's browser case restates it.
