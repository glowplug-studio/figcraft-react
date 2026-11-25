# Roadmap row 15, item 10e: the presenter's chrome

## Execution checkpoint

- Phase: complete through Phase 7 on 25 November 2026 at `34c9421`: [report](../reports/26-11-25-presenter-chrome.md), [matrix](../reports/26-11-25-presenter-chrome-parity.html).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `c074057` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md). The row plan splits the presenter's chrome: Inspect, comments and controllers are item 10f.
- Files changed: `src/engine/prototype-links.ts` (new: `LinkNotice`, `goesToWebsite`, `finishLinks`); `src/engine/prototype-player.ts` (`linkNotice`); `src/engine/prototype-input.ts` (no input while a notice shows, `finish`, `answerNotice`); `src/Presenter.tsx` (the top bar with the flow picker and options menu, Hide UI, the navigation bar with device and size pickers, the link notice, options carried over); tests `tests/parity/prototype-links.test.ts` and one case in `tests/e2e/preview.spec.ts`.
- Next action: none; the item is recorded. Item 10f follows in the row plan.
- Blockers: none.

## Native contract (`ui-egui/src/present/{chrome,player}.rs`)

- **Top bar**: the flow picker shows the flow playing, its description on hover, and lists each flow with its description; picking one restarts there. Then the frame's name. The full-window presenter has Close, Restart and Options (Comments and Inspect come with item 10f); the preview pane has Close preview, Present and Restart.
- **Options menu**: Responsive (without a device, one of the sizes), the size options with their device-aware labels, Next size option (Z); on a device Responsive or Fixed size; Show device frame (a device with colours); Show hotspot hints; Hide UI (Cmd/Ctrl+\); Restart (R). The options carry over to the next presentation.
- **Hide UI**: the bars go and a note says how they come back; Cmd/Ctrl+\ brings them back.
- **Navigation bar**: previous and next frame with the position among the page's frames, the device picker (No device, each device with its size, Custom size: choosing one makes the prototype responsive and starts at the top), and the size picker.
- **Link notice** (#1096): every openable link waits behind "Leaving the prototype", which names a website or the mail app and the link, offers "Don't show this again" only for a link the viewer fired, and has Open link and Cancel; Escape cancels it, not the presentation. With the notice skipped only a link the viewer's own click, press, drag or key fired opens at once, one per frame, never while a notice shows; any further link is dropped while the notice shows. The prototype takes no input meanwhile, and a press under way ends. A link with Open in new tab off opens in place.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `present/chrome.rs::{finish, open_link, goes_to_a_website, link_notice}` | `prototype-links.ts`; `prototype-input.ts` `finish`, `answerNotice`; `Presenter.tsx` | Restated native tests; browser case |
| `present/player.rs::{top_bar, options_menu}`, `present/chrome.rs::{show, navigation_bar, choose_device}` | `Presenter.tsx` | Browser case |

## Acceptance

- Native's link notice tests restated (fifteen cases from `present_links_tests.rs`) and passing.
- A browser case checks the flow picker and its description, the navigation bar's position and stepping, the options menu's sizes, Hide UI with its note and key, a device chosen and cleared in the navigation bar, the link notice's Cancel and Open link, and the options carried over to the next presentation. It failed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
