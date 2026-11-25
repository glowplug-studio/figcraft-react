# Roadmap row 15, item 10d: presenter scrolling and the screen

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `143ff77` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-layout.ts` (new: `presentLayout`, `Place`, `bezel`, scale options, `cycleScale`); `src/engine/prototype-scroll.ts` (`flingAxis`, `rubberBand`, `unitsPerPoint` and the motion constants); `src/engine/prototype-player.ts` (pan, zoom, flings, the wheel, drag scrolling, `setScale`, `resetForDevice`, `respondTo`, `respond`); `src/engine/prototype-input.ts` (wheel, drag scrolling, flings on release, a press catching a fling, the wheel's coast, Z); `src/engine/prototype-screen.ts` (overlays placed on the device's screen); `src/presenter-device.ts` (new: the device's body and glass drawn in code); `src/Presenter.tsx` (laid out by `presentLayout`, the device drawn, the wheel, the scale options); tests `tests/parity/prototype-presenter-view.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: record the item.
- Blockers: none.

## Native contract (`ui-egui/src/present/{layout,scroll,device,input}.rs`, `present.rs`)

- **Layout**: the presented frame sits on its device's screen, the whole device sized by the scale option, else the frame alone. Fit and 100% keep the chrome's padding (32 points in the full window, 12 in the preview pane); Fit never goes above 100%; fit width and fill take the window's width or cover it. A device's body does not scale exactly with its screen, so it is sized once more. What is bigger than the window pans, starting centred across and at the top. The preview pane always fits, with the body drawn. Custom sizes are a bare screen.
- **Scale options (Z)**: fit, fit width, fill, 100%, wrapping round; a device offers no fit width; a responsive frame filling the window has none.
- **Responsive**: the presented frame is resized to the device's screen, or without a device to the whole area at 100%, its constraints and auto layout responding, live with edits and rotation; the file keeps its frame. Choosing a device in the presenter makes it responsive and starts at the top.
- **Scrolling**: the wheel scrolls the innermost frame under the pointer it can still move, else pans a view bigger than the window, and coasts on when it was fast enough as it stopped. A drag that starts no transition scrolls the innermost frame under it that scrolls its way (or pans the view, but not on a phone or tablet), stretching past the ends as a rubber band; let go, it carries on at the pointer's speed and springs back from past the ends. A press catches a fling. Flings are solved exactly over short steps, so they slow down the same at any frame rate.
- **Device**: rounded slabs in the device's colour with black glass round the screen, phone side buttons, a laptop's base and a desktop's stand, rounded screen corners and a phone's camera pill, all drawn in code.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `present/layout.rs::{Place, bezel, body_outset, layout}`, `present.rs::PresentScale` | `prototype-layout.ts` | Restated native tests |
| `present/scroll.rs::{fling_axis, rubber_band, scrollers_at, units_per_point}`, `Presenter::{offset, limits, set_offset, step_fling}` | `prototype-scroll.ts`, `prototype-player.ts` | Restated native tests |
| `present/input.rs` (wheel, drag scroll, release, Z) | `prototype-input.ts` | Restated native tests; browser case |
| `present/navigate.rs::respond_to`, `engine/cmd/proto.rs::respond` | `prototype-player.ts` `respondTo`, `respond` | Restated native tests |
| `present/device.rs` | `presenter-device.ts`; `Presenter.tsx` | Browser case with pixels |

## Acceptance

- Native's `flings_slow_down_the_same_at_any_frame_rate`, `rubber_band_stretches_less_the_further_it_goes`, `scale_options_match_the_command_and_cycle`, `presenter_scales_by_its_options_and_pans_what_overflows`, `devices_turn_and_their_frame_can_hide`, `scrolling_keeps_its_momentum_and_springs_back_from_the_ends`, `the_wheel_coasts_after_it_stops`, `responsive_frames_take_the_devices_screen_live`, `without_a_device_a_responsive_frame_fills_the_window_at_100_percent`, `custom_sizes_present_as_a_bare_screen`, `device_picker_reflows_without_resizing_the_saved_frame_and_can_revert`, `device_presets_show_their_screen_at_the_real_resolution_in_their_body` and `a_phone_scrolls_only_what_the_frames_overflow_allows` restated and passing.
- A browser case presents a frame on an iPhone 16 in Pink and checks the screen, the glass and the body by pixels, the wheel and a drag scrolling the content, and Z filling the window. It failed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
