# Roadmap row 15, item 9: canvas connections

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `04531a3`: [report](../reports/26-11-25-canvas-connections.md), [matrix](../reports/26-11-25-canvas-connections-parity.html).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `37a6bc0` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md). Also closes [delta ledger](26-11-20-upstream-delta-ledger.md) item 5.3 (#2158, #2161).
- Files changed: `src/engine/prototype-connections.ts` (new: `curveBetween`, `dragCurve`, `bezierAt`, `bezierDistance`, `connections`, `frameAt`, `targetAt`, `handleRadius`); `src/PrototypeConnections.tsx` (new: the overlay); `src/PrototypePanel.tsx` and `src/Editor.tsx` (the open interaction shared by the panel and the canvas); tests `tests/parity/prototype-connections.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract (`ui-egui/src/canvas/proto_canvas.rs`)

- While the Prototype tab is open, each interaction with a destination on the page draws a connection from its layer to the destination, leaving the side facing it, with a dot at its start and an arrowhead at its end; a selected layer's or open interaction's connection is stronger and outlines its destination.
- Each selected layer (up to 32) has a "+" handle at its right edge. Dragged, it draws a connection to the pointer and outlines what it would land on; released over a frame other than the layer's own (or a section) it adds a click navigating there, over a sibling variant of the layer's own variant it adds a Change to it (#2158), and over the layer's own variant or its set's background nothing, a grouped set's background included (#2161). The new interaction's editor opens.
- A click within five points of a connection selects its layer and opens that interaction's editor.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `proto_canvas.rs::{curve_between, bezier, bezier_distance, noodles, frame_at, variant_of, target_at}` | `prototype-connections.ts` | Restated `curves_leave_the_facing_side` and `proto_variant_connect_tests.rs` |
| `proto_canvas.rs::{draw, input, handles, arrow, plus_handle}` | `PrototypeConnections.tsx` | Browser case |

## Acceptance

- Five restated native cases pass (curves, sibling variants both ways, a layer in a variant, the set's background and own variant in plain and grouped sets, a frame outside the set) and a connection listing case. The browser case drags a frame's handle onto another frame, a variant's onto its own variant (nothing) and onto its sibling (Change to), and clicks a connection to open its editor; the saved file matches. Both failed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
