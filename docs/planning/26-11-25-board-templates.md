# Roadmap row 16, item 7: grids and templates

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `a4a4e53`: [report](../reports/26-11-25-board-templates.md), [matrix](../reports/26-11-25-board-templates-parity.html), [provenance](../../tests/fixtures/native-board-templates.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `6b0e410` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-templates.ts` (new: the five templates, `templateList`, `findTemplate`, `buildTemplate`); `src/engine/board-grid.ts` (new: `BoardGrid`, `boardGridCommand`); `src/engine/board-commands.ts` (`board.template`, built by running the board commands in one step); `src/engine/editor.ts` (`board.templates`, `board.grid` kept with the session and published in the snapshot, fonts prepared for template text); tests `tests/parity/board-templates.test.ts`, fixture `tests/fixtures/native-board-templates.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded. Item 8 follows in the row plan.
- Blockers: none.

## Native contract (`engine/src/boards/board_grid.rs`, `board_templates.rs`)

- **board.templates** lists the five templates: id, name, description, width and height.
- **board.template** `{name, x?, y?}` places one, by id or by its name in any case, from its top-left (centred in the view by default). It is made of ordinary board objects (titles, sections, stickies without an author, shapes, connectors and labels) by running the board commands, in one undo step, and the objects placed on the page are selected:
  - Retrospective: three tinted sections with two stickies each.
  - Brainstorm: a question with four clusters of two stickies joined to it.
  - Weekly planner: five day sections with a sticky each.
  - Flow chart: six shapes joined by elbow connectors, two of them labelled.
  - Kanban: three columns of cards.
- **board.grid** `{style?, spacing?, major?, size?, contrast?, reset?}` sets the board canvas's grid (dots, lines, graph or none), kept with the preferences, its numbers clamped to their ranges; with nothing given it reads it.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `engine/src/boards/board_templates.rs` (`TEMPLATES`, `find`, `template_cmd`, `Builder`, the five layouts) | `board-templates.ts`; `board-commands.ts`; `editor.ts` | Native observation |
| `engine/src/boards/board_grid.rs` (`GridStyle`, `BoardGrid`, `sanitized`, `grid_cmd`) | `board-grid.ts`; `editor.ts` | Native observation |

## Acceptance

- Each of native's five templates is placed with native's receipt and the same layers (text heights and what follows from them left out).
- The list, finding by name, the refusals and the grid's answers are reproduced.
- A browser case draws the retrospective's section and sticky. It failed before (no templates).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
