# Roadmap row 15, item 10b: presenter transitions

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `130a371`. **This bounded item passes. Items 10c to 10e (gestures and overlays in motion, scrolling and the screen, the presenter's chrome), the roadmap and the full port remain unfinished.**

## Implemented boundary

The presenter now plays native's transitions ([`prototype-transitions.ts`](../../src/engine/prototype-transitions.ts), [`Presenter.tsx`](../../src/Presenter.tsx)): the outgoing and incoming frames are rendered off screen and composited as native's `transition_frames` places them, moved and faded at the eased progress and clipped to the screen; smart animate draws the destination with matched layers tweened in place, rotation, scale, size, opacity, corner radii and solid colours, destination-only layers fading in and source-only layers copied in and fading out; and a Scroll to plays over its duration.

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `present/tests.rs`: `matching_by_name_path`, `smart_interpolate_tweens_matched_and_fades_the_rest`, `transitions_move_the_right_way` | Pass; failed before |
| Browser: a push | A 4-second linear push left: mid-way the outgoing white frame on the left, the incoming red one on the right, the background outside the screen; then the red frame fills it | Pass, by pixels; failed before (no transitions) |

## Recorded differences

- **Overlays in motion.** An overlay still appears and goes at once; its opening and closing transitions come with item 10c.
- **Images, not textures.** The frames are rendered to off-screen canvases and composited per animation frame (smart animate re-renders each frame), where native uploads textures; what is drawn is the same.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/present/transition.rs::{name_path, match_layers, lerp_transform, smart_interpolate, transition_frames}` | `prototype-transitions.ts` |
| `crates/ui-egui/src/present/draw.rs`, `present/player.rs` (Scroll to) | `Presenter.tsx`, `prototype-player.ts` |

[Property matrix](26-11-25-presenter-transitions-parity.html) · [Plan](../planning/26-11-25-presenter-transitions.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-transitions.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `130a371`, native reference `bad07e44` |
| Failing fixtures first | The parity and browser cases failed before |
| Full pure suite | 5,640 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 436 cumulative Chromium cases passed in one 17.0-minute run at `130a371` with zero skips, retries, flakes or suite errors: the 435 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 13.84 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,388 nodes/40,005 edges at `130a371`; native 28,939/92,127 at `bad07e44`; combined 38,327/130,906. `smartInterpolate`, `matchLayers`, `transitionFrames`, `lerpTransform` and `frameScreen` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-transitions.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "push transition" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 10c to 10e.
