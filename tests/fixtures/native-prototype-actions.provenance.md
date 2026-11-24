# Native observations for prototype action and conditional-block commands

Data: [native-prototype-actions.json](native-prototype-actions.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

One command sequence, each step with its parameters and native's receipt or error, and the stored interactions of frame 2 at three saves.

| Steps | What they cover |
|---|---|
| Setup | A Theme collection with `count` (number) and `done` (boolean); two frames; a click-navigate on frame 2 |
| `proto.action.add` | Default and explicit paths, inside a conditional's block; refusals: past the end, an even or fractional path, a path that is not a list, a path through a non-conditional, no action, no interaction, a missing destination, a missing variable; expression text read |
| `proto.conditional.*` | An else if with the default condition, the else, a second else refused, an else if before the else, conditions from text and JSON, refusals (else with a condition, a non-boolean `else`, not a conditional, a number condition, no block, no condition); removing blocks, and the conditional with them when no if is left |
| `proto.action.set`, `move`, `remove` | Replace, reorder, remove, with their refusals; the last action kept |
| Several targets | A target without the interaction skipped; none having it refused |
