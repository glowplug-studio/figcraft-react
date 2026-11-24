# Roadmap row 15, item 10a: the presenter

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `5c165c1` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/Presenter.tsx` (new: the full-window presenter and the preview pane); `src/engine/prototype-screen.ts` (new: `presentedScreen`, `hotspotAt`, `outsideTopOverlay`, `keyTarget`); `src/engine/prototype-overlays.ts` (new: `anchorOffset`, `overlayRect`, `anchoredOverlayRect`); `src/engine/editor.ts` (`closePrototypePlayer`); `src/Editor.tsx` (opens the presenter from the request); tests `tests/parity/prototype-overlays.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract

- **`present.rs`, `present/player.rs`, `present/layout.rs`**: `proto.present` opens the full-window presenter and `proto.preview` the preview pane, each playing the player (item 7c) from its start; the bar names the flow and the frame and has Restart, Close (and in the pane Present and Close preview); Fit scales the frame down to the window (never above 100%), centred, on the page's prototype background.
- **`transition.rs::overlay_rect`, `present.rs::anchored_overlay_rect`, `doc/src/proto.rs::OverlayAnchor::offset`**: an overlay is placed on the screen by its preset, or by its preset measured on the layer that opened it (inside or outside), or manually from that layer; its background covers the screen under it.
- **`present/input.rs`**: a click reaches the top-most hotspot of what shows (the top overlay, else the frame) with a click, press or mouse down or up interaction; a click outside the top overlay closes it when it closes on a click outside; keys fire key triggers of what shows; Escape closes the full-window presenter; the pane takes keys only while the pointer is over it. After-delay interactions fire when due and delayed mouse triggers when their wait ends.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/proto.rs::OverlayAnchor::offset`, `present/transition.rs::overlay_rect`, `present.rs::anchored_overlay_rect` | `prototype-overlays.ts` | Restated `proto_overlay_anchor_tests.rs` and `overlay_positions` |
| `present/{layout,draw}.rs` (what shows, Fit) | `prototype-screen.ts` `presentedScreen`; `Presenter.tsx` | Browser case with pixels |
| `present/input.rs` (clicks, keys, outside clicks, timers) | `prototype-screen.ts` `hotspotAt`, `outsideTopOverlay`, `keyTarget`; `Presenter.tsx` | Browser case |
| `present/player.rs::top_bar` | `Presenter.tsx` | Browser case |

## Acceptance

- Four restated native cases pass. The browser case presents a flow, checks the frame is drawn white on the dark prototype background, clicks to navigate, presses a key to go back, opens an overlay and closes it from outside (a click on it keeps it), restarts, closes with Escape, and opens and closes the preview pane. Both failed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
