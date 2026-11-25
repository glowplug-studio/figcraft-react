# Roadmap row 16, item 3: connectors

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `9b457e5`: [report](../reports/26-11-25-board-connectors.md), [matrix](../reports/26-11-25-board-connectors-parity.html), [provenance](../../tests/fixtures/native-board-connectors.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `d722e71` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 16](26-11-25-roadmap-row-16-boards.md).
- Files changed: `src/engine/board-route.ts` (new: native's `board_route` — route points straight, elbow and curved, the way round joined objects, the end gap, hand-placed ends, reshaped paths, path handles); `src/engine/board-commands.ts` (`board.connector`, `board.reattach`, `board.label`, a connector's route written into its line, labels at its middle, `settleBoardRoutes`); `src/engine/editor.ts` (routes settled after each edit, fonts prepared for labels); tests `tests/parity/board-connectors.test.ts`, fixture `tests/fixtures/native-board-connectors.json` with provenance, and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded. Item 4 follows in the row plan.
- Blockers: none.

## Native contract (`doc/src/board_route.rs`; `engine/src/boards/board/{connectors,derived,edit}.rs`)

- **Routes**: an end attached to a layer starts 4 outside the middle of the side facing the other end, or the side it names; a wide box takes the sides more. A hand-placed end keeps its point; a free end is a point.
  - Straight runs end to end.
  - Elbow leaves and arrives along the sides' normals: halfway across between two sides facing the same way, one turn otherwise. When that crosses a joined object, it takes the cheapest of a few ways round, 24 clear.
  - Curved is one curve leaving and arriving along the normals.
  - A path reshaped by hand is kept for its routing.
- **board.connector** `{from, to, fromSide?, toSide?, fromAt?, toAt?, style?, startCap?, endCap?, label?}`: a vector named Connector on the page, stroked 2 in `#3A3936` with round joins, no cap at the start and a triangle arrow at the end by default. Its box and network are the route (a curve as one segment, runs as a line through points).
- **board.reattach** `{id?, end, target, side?, at?}` moves one end (dropping a hand-shaped path). A label stands for its connector.
- **board.label** `{id?, text}`: a white frame named Label (radius 4, padding 3 and 6, hugging a centred 12-point text) at the connector's middle by length; empty text removes it.
- **Settling**: after an edit, connectors whose ends moved run between them again. An end whose layer is gone stays where it was drawn, as a point; a connector moved on its own takes its free ends along. Labels sit at their connectors' middles and go with them.
- **Refusals**: two ends on one layer, a connector as an end, an end on another page, ends in the same place, unknown sides, caps and styles; native's messages.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/board_route.rs` | `board-route.ts` | Restated native route tests; native observation |
| `engine/src/boards/board/connectors.rs::{at_param, end_param, connector_cmd, make, connector_of, reattach}`, `edit.rs::{label_of, set_label, label_cmd}` | `board-commands.ts` | Native observation; parity tests |
| `engine/src/boards/board/derived.rs::{settle_routes, detach_gone_ends, carry_free_ends, place_label, ends_now, route_mid, route_path, place_route, route, route_ends}` | `board-commands.ts` `settleBoardRoutes`; `editor.ts` | Native observation; browser case |

## Acceptance

- Native's run of six connectors with labels, a reattached end, a moved shape, a restyle and recolour, and a deleted shape is replayed by the port. It gives native's receipts, the same connectors (board item, network, box, stroke) and labels at the same middles, before and after the deletion.
- Native's three route tests are restated, as are its refusals for reattaching.
- A browser case moves a joined shape and sees its connector follow. It failed before (there were no connectors).
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
