# Native observations for prototype expressions

Data: [native-prototype-expressions.json](native-prototype-expressions.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

One command sequence, each step with its parameters and native's receipt or error, and the stored interactions of frame 2 at the final save.

| Steps | What they cover |
|---|---|
| Setup | A Theme collection (Light, Dark) and variables `count`, `done`, `name`, `accent` (red in Light, blue in Dark), `count total`, `not done` and `2x` |
| `proto.evaluate` with text | Arithmetic, joining text with trimmed numbers, comparisons and chains, `not` and `!` against a variable named `not done`, `{name}` and longest-name matching, modes and `name[Mode]`, colours, exponents, Rust number display, operator nesting in the display, and every kind of parse and type error |
| `proto.evaluate` with JSON | Names in `expr` stored as ids; a missing expression; a missing layer; a layer in the Dark mode |
| Interaction commands | A set variable from text, by name; type and name refusals; a set variable mode by names and an unknown collection kept as given; conditional blocks from text and JSON; `expr` names resolved; text replacing a given `expr`; a patched action |
