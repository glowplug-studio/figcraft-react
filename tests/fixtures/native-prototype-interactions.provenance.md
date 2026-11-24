# Native observations for prototype interaction and flow commands

Data: [native-prototype-interactions.json](native-prototype-interactions.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

Three command sequences, each step with its parameters and native's receipt or error; at each `file.saveAs` (as data) the stored interactions and flows of every node.

| Sequence | What it covers |
|---|---|
| `interactions` | A click-navigate from `dest`; a key-press interaction with transition, duration and easing; patching its transition and easing; an overlay with a CSS background and an offset dropped off a manual position; a manual offset clamped; a delay kept on mouse enter, capped, and dropped on click; refusals (missing index, missing destination, no actions, bad index, missing action, unknown action type); removal across several targets; clear |
| `flows` | First flow named Flow 1, an existing flow answered, a blank name, rename with trim and description, refusals (blank name, no flow, not a top-level frame), the selection as the start, removal and the next unused default name |
| `limits` | Duration clamped, delays rounded and refused, a whole replacement, a patched delay on a mouse trigger, an interaction on the page, `dest` with `action`, `actions` empty falling back to `action`, camelCase spellings, a custom bezier, the target errors (`ids` not an array, a bad `id`, a missing node, nothing selected) |
