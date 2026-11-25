# Roadmap row 15, item 10b: presenter transitions

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `770020d` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-transitions.ts` (new: `namePath`, `matchLayers`, `lerpTransform`, `smartInterpolate`, `transitionFrames`); `src/engine/prototype-player.ts` (`stepScrollAnimation`, `transitionProgress`); `src/engine/prototype-screen.ts` (`frameScreen`); `src/Presenter.tsx` (transitions composited, smart animate, Scroll to animated); tests `tests/parity/prototype-transitions.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`ui-egui/src/present/{transition,draw}.rs`)

- **`transition_frames`**: each transition places the outgoing and incoming frames as fractions of their size: move in brings the new frame in from the edge opposite its direction, move out takes the old one out over the new, push moves both, slide in and slide out move the other by 0.3, dissolve and smart animate fade the new one in, instant swaps. The frames' images are drawn clipped to the screen (a dissolve without a device shows both whole).
- **`match_layers`, `smart_interpolate`, `lerp_transform`**: smart animate pairs layers by their name path below the two frames (repeats in layer order) and draws the destination at the eased progress: matched layers tween centre, rotation (the shortest way), scale, size, opacity, corner radii and solid colours; destination-only layers fade in; source-only layers are copied in and fade out; at the end it is the destination exactly.
- **`player`**: a Scroll to plays over the interaction's duration with its easing.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `present/transition.rs::{name_path, match_layers, lerp_transform, smart_interpolate, transition_frames}` | `prototype-transitions.ts` | Restated native tests |
| `present/draw.rs` (compositing a transition), `present/player.rs` (Scroll to animation) | `Presenter.tsx`; `prototype-player.ts` `stepScrollAnimation`, `transitionProgress` | Browser case with pixels |

## Acceptance

- Three restated native tests pass; a browser case presents a slow linear push and checks mid-way that the outgoing frame (white) shows on the left, the incoming one (red) on the right and the background outside the screen, then that the incoming frame fills the screen. Both failed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
