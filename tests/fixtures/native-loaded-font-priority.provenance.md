# Native observations for loaded font priority (upstream 34c44e60, a375ac06, #2092)

Data: [native-loaded-font-priority.json](native-loaded-font-priority.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.
- The native build has no embedded fonts (no `CRAFT_FONTS_DIR`), so its Inter consists only of the faces the case loads. The port bundles Inter; its built-in Inter Regular has to lose to the loaded faces for the widths to match.

## Font files

Each `text.loadFont` step names `[source, family, style]`: the packaged `fonts/inter/Inter-<source>.ttf` with its name table rebuilt (names 1, 2, 4, 6, 16 and 17 for Windows Unicode English) for that family and style and appended at the end of the file. `retitledFont` in [renamedFont.ts](../support/renamedFont.ts) builds them; its output was checked to be byte for byte the files loaded natively.

## What the file holds

| Case | Steps | What native gives |
|---|---|---|
| builtin | A text "Wide wording here" in Inter Regular; load Inter Bold named Inter Regular, then Inter SemiBold named Inter Regular, then the bold file again | Width 111 after the bold load (refitted [2]), 110 after the semibold load (refitted [2]); the same bold file again returns its families with refitted [] and leaves the width at 110 |
| proof | Load Inter Regular named Proof Regular, then Inter Bold named Proof Regular; a text in Proof | Width 111, the bold face: the latest load wins |

Native's own unit test `fontdb::tests::a_loaded_face_wins_over_the_built_in_one_of_its_family_and_style` (also restated in the port's `FontLibrary` case) covers a later non-loaded face and another style's built-in face.

## Reproduction outside the port runtime

Build the files with `retitledFont`, base64 them, and run the `replay` executable with `[{"name", "commands": [...]}]`, sending `["text.loadFont", {"data": <base64>}]` for each font step.
