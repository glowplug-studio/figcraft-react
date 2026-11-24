# Roadmap row 15: prototype interactions

## Execution checkpoint

- Phase: item 1 implemented at the item commit; its gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `d2ce2b7` on `prompt/full-figcraft-port`.
- Source: row 15 of the [master plan](26-11-06-complete-figcraft-port.md) and the `proto.*` commands of the [command inventory](../parity/full-port-command-inventory.json).
- Native oracle: `$HOME/.cache/figcraft-oracle/project`; `replay` runs command sequences through the pinned engine. It observes every engine command of this row. The presenter and the canvas connections are interface, restated from native interface tests.
- Next action: record item 1, then plan item 2.
- Blockers: none.

## What the port has

The document model reads and writes prototype data in every format the port opens: interactions with their triggers, actions (conditional blocks and expressions as stored trees), transitions, easing and delays (`prototype-data.ts`), page flows and the page's prototype background. Penpot, `.fig` and REST interchange carry them. No `proto.*` command existed, nothing edits prototype data, and there is no presenter.

## Native surface

- **Document** (`doc/src/proto.rs`, `proto_expr.rs`, `proto_expr_parse.rs`): `Trigger`, `Action`, `Transition`, `Easing`, `Interaction`, `Flow`, `PrototypeSettings` (device, colour, rotation, custom size, responsive, background), the expression tree, its text parser and evaluator, `Overflow` and `ScrollPosition`.
- **Commands** (`engine/src/cmd/proto.rs`, `proto_actions.rs`), 21 in the inventory: `proto.interaction.{add,clear,remove,set}`, `proto.flow.{add,rename,remove}`, `proto.action.{add,move,remove,set}`, `proto.conditional.{addBlock,removeBlock,setCondition}`, `proto.evaluate`, `proto.settings`, `proto.present`, `proto.preview`, `proto.closePreview`, `proto.presentOptions`, `proto.linkNotice`.
- **Runtime** (`engine/src/proto_run.rs`, `cmd/proto.rs::respond`): what an action does to the player's state, responsive frames.
- **Interface** (`ui-egui/src/present.rs`, `present/*`, about 4,900 lines; the prototype tab of the right panel; `canvas/proto_canvas.rs`): the presenter (navigation, overlays, transitions, scrolling, variables, device frames, hotspot hints, Inspect, Hide UI), the preview pane, the interaction editor, and connections drawn on the canvas.

## Order

Engine commands come first, since `replay` observes them, from the simplest data edits to expressions; the settings follow; then the presenter's state machine (pure, restated from native tests), and last the interface: the prototype tab, the canvas connections and the presenter itself.

| Item | Behaviour | Native files and tests | React files | Status |
|---|---|---|---|---|
| 1 | Interaction and flow commands: add, edit, remove and clear interactions; add, rename and remove flows | `cmd/proto.rs` and its tests | `prototype-commands.ts`, `prototype-data.ts`, `editor.ts` | Implemented; gate running ([plan](26-11-24-prototype-interactions.md)) |
| 2 | Expression text (`count + 1`, `count >= 3`) parsed into stored trees with names resolved to ids; `proto.evaluate` | `doc/src/proto_expr*.rs`, `cmd/proto_actions.rs::with_expressions`; `proto_expr_*tests.rs` | expression parser, `prototype-commands.ts` | Planned |
| 3 | Action and conditional-block commands: `proto.action.*`, `proto.conditional.*` | `cmd/proto_actions.rs` and its tests | `prototype-commands.ts` | Planned |
| 4 | Prototype settings: device list, colours, rotation, custom size, responsive; stored and read | `doc/src/proto.rs::PrototypeSettings`, `cmd/proto.rs::settings` | the page model, file format, `prototype-commands.ts` | Planned |
| 5 | Player requests and preferences: `proto.present`, `proto.preview`, `proto.closePreview`, `proto.presentOptions`, `proto.linkNotice` | `cmd/proto.rs::open_player`, preferences | `prototype-commands.ts`, editor requests | Planned |
| 6 | The player's state machine: navigation, back, overlays (positions, anchors, swap, close), scroll to, variables and modes, conditional actions, delays, responsive frames | `engine/src/proto_run.rs`, `ui-egui/src/present/{player,navigate,actions,scroll}.rs`; `present/*tests.rs`, `proto_*_tests.rs` | a pure player module | Planned |
| 7 | The prototype tab: flows, interactions and their editor; Overflow and scroll position | `ui-egui` right panel prototype tab; `proto_editor_tests.rs`, `proto_reorder_tests.rs` | a prototype panel | Planned |
| 8 | Canvas connections: drawn arrows, dragging a connection to a destination, Change to on a sibling variant (delta item 5.3) | `ui-egui/src/canvas/proto_canvas.rs`; `proto_variant_connect_tests.rs` | canvas overlay | Planned |
| 9 | The presenter and preview pane: transitions and easing, device frames, scale options, hotspot hints, Inspect, Hide UI, link notice | `ui-egui/src/present.rs`, `present/{draw,transition,device,chrome,layout,input}.rs`; `present_*tests.rs` | presenter view | Planned |

## Acceptance per item

Native observations recorded with provenance where `replay` reaches the behaviour, restated native tests where it does not; each new case fails without its change; the full pure suite, strict types, both builds, the cumulative browser gate, provider integrations once, zero fixture counts and the local graph pass before the item is recorded. Items without an interface take their browser case with the interface item that exposes them.
