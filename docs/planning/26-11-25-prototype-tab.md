# Roadmap row 15, item 8a: the prototype tab

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `81c6c58`: [report](../reports/26-11-25-prototype-tab.md), [matrix](../reports/26-11-25-prototype-tab-parity.html).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `6e4ae95` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/PrototypePanel.tsx` (new); `src/engine/prototype-summaries.ts` (new: `triggerSummary`, `actionLabel`, `actionSummary`, `interactionSummary`, `sectionsIn`, `navigationTargets`, `newInteractionAction`, `interactionTargets`); `src/Editor.tsx` (Design and Prototype tabs); tests `tests/unit/prototype-summaries.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract (`ui-egui/src/panels/proto_panel.rs::prototype`)

- **Nothing selected**: the page's flow starting points (add the first top-level frame without one, else a notice; each row presents, previews, renames and removes; descriptions under them) and the prototype settings (device with rotation for devices that turn, its colours, a custom size's width and height with a swap, responsive, background, and the preview button).
- **A top-level frame**: its flow starting point (preview and add, or its row and description).
- **Layers**: their interactions, each with its trigger and actions summarised; Add adds a click navigating to the first frame that is not the layer's own (or Back), on every selected layer when they all have the same interactions; Remove removes one. Layers with different interactions show "Mixed interactions" with Replace and Remove all.
- **Scroll behaviour**: a layer in a frame has its position (scroll with parent, fixed, sticky); a frame its overflow.

## The port

`PrototypePanel.tsx` follows that structure with the port's form controls, behind a Design and Prototype switch on the right panel (pressed buttons, not ARIA tabs: the document tabs above the canvas are the page's tabs, and the first gate run caught the clash). Clicking an interaction opens native's editor, which is item 8b.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `proto_panel.rs::{prototype, flows_overview, flow_row, flow_section, settings, device_colors, custom_size, interactions, mixed_interactions, scroll_section}` | `PrototypePanel.tsx` | Browser case |
| `proto_panel.rs::{trigger_summary, action_summary, action_of, targets_for, nav_targets}`, `doc/src/lib.rs::sections_in` | `prototype-summaries.ts` | Unit cases following native's code |

## Acceptance

- The browser case adds and renames a flow, picks a device, colour and rotation, sets responsive and the background, adds two interactions and removes one, and sets a scroll position and an overflow; the saved file carries each. The unit cases check the summaries and defaults. Both failed before (no tab).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
