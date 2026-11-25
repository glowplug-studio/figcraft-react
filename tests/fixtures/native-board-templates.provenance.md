# Native observations for board templates and the grid

Data: [native-board-templates.json](native-board-templates.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 25 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

`templates` holds, for each of native's five templates (retrospective, brainstorm, weekly planner, flow chart, kanban), native's receipt for `board.template {name, x: 0, y: 0}` on a new board and the `document.json` saved after it.

`misc` holds a run with native's answer to each command:

- the template list, and a template found by its name in another case;
- the refusals: an unknown template and a missing name;
- `board.grid`: read, set out of range (clamped), refused for an unknown style or a non-number, reset, and set again.
