# Roadmap row 15, item 10e: the presenter's chrome

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `34c9421`. **This bounded item passes. Item 10f (Inspect, comments and controllers in the presenter), the roadmap and the full port remain unfinished.**

## Implemented boundary

The presenter now has native's chrome ([`Presenter.tsx`](../../src/Presenter.tsx)):

- **Top bar.** The flow picker shows the flow playing with its description on hover, and lists each flow with its description. Then come the frame's name and Close, Restart and Options (the preview pane has Close preview, Present and Restart).
- **Options menu.** Responsive, the size options under their device-aware labels, Next size option (Z), Responsive or Fixed size on a device, Show device frame, Show hotspot hints, Hide UI and Restart. The options carry over to the next presentation.
- **Hide UI.** The bars go and a note says that Cmd/Ctrl+\ brings them back.
- **Navigation bar.** Previous and next frame with the position among the page's frames, the device picker (choosing a device makes the prototype responsive and starts at the top) and the size picker.

The notice before a link leaves the prototype (#1096) follows native's `finish` and `link_notice` ([`prototype-links.ts`](../../src/engine/prototype-links.ts), [`prototype-input.ts`](../../src/engine/prototype-input.ts)):

- Every openable link waits behind "Leaving the prototype". It offers "Don't show this again" only for a link the viewer fired; ticking it is saved with `proto.linkNotice` when the link opens.
- With the notice skipped, only a link the viewer's own click, press, drag or key fired opens at once, one per frame, and never while a notice shows.
- The prototype takes no input while the notice shows, and Escape cancels the notice, not the presentation.
- A link with Open in new tab off opens in place.

## Evidence

| Case | Content | Result |
|---|---|---|
| Restated native tests | `present_links_tests.rs`: web and mail links, a skipped notice for links no click fired, the checkbox, one link per click, a pointer passing, delayed opens not piling up, mail links, links queued after a click, keys, Cancel, no keys or clicks while the notice shows, Don't show this again, script and handler links, nothing opening while a notice shows, a press that raised a notice, links in place | Pass. Fifteen cases |
| Browser | The flow picker and its description, frame stepping in the navigation bar, the options menu's sizes, Hide UI with its note and key, a device chosen and cleared, the notice's Cancel and Open link, the options carried over | Pass; failed before |

## Recorded differences

- **Full screen.** Native's F key asks the desktop window to fill the screen; a browser page cannot do that from a key press without the browser's own permission, so the presenter does not take F.
- **The bar's thumbnail.** Native shows a small picture of the frame beside its name in the full-window bar; it comes with item 10f, with Comments and Inspect.
- **Opening a link.** Native hands a link to the platform; the browser opens a new tab with `noopener`, or the page itself for a link with Open in new tab off.

## Native mapping

| Native | React |
|---|---|
| `crates/ui-egui/src/present/chrome.rs::{finish, open_link, goes_to_a_website, link_notice}` | `prototype-links.ts`, `prototype-input.ts`, `Presenter.tsx` |
| `crates/ui-egui/src/present/player.rs::{top_bar, options_menu}`, `present/chrome.rs::{show, navigation_bar, choose_device}` | `Presenter.tsx` |

[Property matrix](26-11-25-presenter-chrome-parity.html) · [Plan](../planning/26-11-25-presenter-chrome.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-links.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `34c9421`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,680 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 439 cumulative Chromium cases passed in one 17.3-minute run at `34c9421` with zero skips, retries, flakes or suite errors: the 438 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 15.72 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,535 nodes/40,584 edges at `34c9421`; native 28,939/92,127 at `bad07e44`; combined 38,474/131,470. `finishLinks`, `goesToWebsite`, `answerNotice`, `presentLayout` and `PresenterInput` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-links.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "the presenter's chrome" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 item 10f.
