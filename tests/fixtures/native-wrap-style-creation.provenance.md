# Native observations for creating a text style from an edited selection

Data: [native-wrap-style-creation.json](native-wrap-style-creation.json).

- Native revision `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 through the prebuilt `replay` executable from the [ellipse provenance](native-ellipse-four-anchor.provenance.md). The executable SHA-256 was `9bbffd3f5e53d425051c20e87870c94b660429064098e95569c4571b84564e9e`. The pinned source was mounted read-only in the existing `rust:latest` Docker image.

For mixed wraps, `style.create` defines the style with the layer's wrap and links the selected characters. Native `cmd/styles.rs::create` links the characters, and `derived.rs::normalize` propagates the new catalogue definition to those linked characters in the same transaction. The touched paragraphs take the fallback wrap for both an auto layer and a pretty layer. For a uniform selection within one paragraph, the definition takes its balance wrap and only the selected characters link.

To reproduce, give `replay` an array with each case's `name` and `commands`, using `[step.command, step.params]` for each command. Keep the `style.create` receipt, the `id`, `name` and `paragraph` from each `style.list` entry, and `wrapStyle`, `lineWrapStyles`, `textStyleRanges` and `styles.text` from each `node.get`. The fixture represents missing values as `null`.
