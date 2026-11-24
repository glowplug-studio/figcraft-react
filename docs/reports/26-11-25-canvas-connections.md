# Roadmap row 15, item 9: canvas connections

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `04531a3`. **This bounded item passes and closes delta ledger item 5.3. The presenter (item 10), the roadmap and the full port remain unfinished.**

## Implemented boundary

While the Prototype tab is open, the canvas now shows native's prototype connections ([`PrototypeConnections.tsx`](../../src/PrototypeConnections.tsx), [`prototype-connections.ts`](../../src/engine/prototype-connections.ts)): a curve from each layer with an interaction to its destination, leaving the side facing it, stronger for the selection and the open interaction with the destination outlined; a "+" handle on each selected layer that drags out a new connection, outlining its target, and adds a click navigating to a frame or section, or a Change to a sibling variant (#2158), but nothing over the layer's own variant or its set's background, grouped sets included (#2161); and a click on a connection opens its interaction in the editor. The panel and the canvas share which interaction is open.

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `proto_canvas.rs` `curves_leave_the_facing_side`; `proto_variant_connect_tests.rs` (siblings both ways, a layer in a variant, the set's background and own variant in plain and grouped sets, a frame outside the set) | Pass at the drop point in page units; failed before |
| Browser: connections | A frame's handle dropped on another frame; a variant's dropped on itself, then on its sibling; a connection clicked | Navigate to, nothing, Change to and the open editor as native's; the saved file matches |

## Recorded differences

- **Drawing.** The connections are an SVG overlay over the canvas; native draws them with egui. The hit tolerance is a ten-point-wide invisible stroke (five points either side, as native's test).
- **Overlay ghosts.** Native also previews an overlay's place while editing an Open overlay action (`overlay_ghost`); that belongs with the presenter's overlay placement (item 10).

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/canvas/proto_canvas.rs::{curve_between, bezier_distance, noodles, frame_at, variant_of, target_at}` | `prototype-connections.ts` |
| `crates/ui-egui/src/canvas/proto_canvas.rs::{draw, input, handles}` | `PrototypeConnections.tsx` |

[Property matrix](26-11-25-canvas-connections-parity.html) · [Plan](../planning/26-11-25-canvas-connections.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-connections.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `04531a3`, native reference `bad07e44` |
| Failing fixtures first | The parity and browser cases failed before |
| Full pure suite | 5,633 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | Of 434 cumulative Chromium cases, 426 passed in one 32.1-minute run at `04531a3`'s source; eight 10,000-node frame-budget cases (profile rendering, four stroke previews, transform scale, vector point move and region previews) failed while macOS media analysis held the load average at 11 to 13, the same family that fails under that load at code which passed every case at a normal load: environmental under the standing load rule. Two earlier runs of this item were cut short by the same load, and one left local test rows, removed before the counts. No baseline changed |
| Real local provider integrations | 32 passed in 18.07 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,341 nodes/39,768 edges at `04531a3`; native 28,939/92,127 at `bad07e44`; combined 38,280/130,671. `PrototypeConnections`, `curveBetween`, `targetAt`, `connections` and `frameAt` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-connections.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "connections drag from" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 item 10: the presenter and preview pane.
