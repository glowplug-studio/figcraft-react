# Upstream delta row 2, item 7: marquee selection

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `f66ead9`. **This bounded item passes. Twelve items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `cb526214` and `604c7846` replaced the marquee rule with the one measured in the target application. [marquee.ts](../../src/engine/marquee.ts) ports it.

- **Top-level layers, whole.** Each top-level layer the marquee touches is selected whole. A group and an empty frame are selected on touch.
- **Frames and sections open.** A frame with children, or a section with its contents shown, is selected itself when the marquee covers it. Partly covered, it gives the layers in it that the marquee touches. Before, the port skipped a partly covered frame.
- **A drag begun inside a frame** selects the layers it touches inside and outside the frame, never the frame itself, unless the marquee also takes another top-level frame whole. Then the frame comes whole. Before, the port selected only that frame's children.
- **Once a frame is taken whole** the marquee stays at the top level: no frame opens, and a partly covered one comes whole.
- **Components and instances** are selected only when covered.
- **Rotated shapes are touched by their outline.** A rotated rectangle, ellipse, polygon, star, line or vector is selected when the marquee holds a path end, crosses a path segment, or lies inside the filled shape. Before, the page box alone decided.
- **Covered** means both corners of the layer's page box are inside the marquee; a far edge exactly on the marquee's far edge is not.

Ctrl or Cmd (the innermost layers), Shift (toggle), and hidden and locked layers behave as before and are now pinned by native observations.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-marquee.json](../../tests/fixtures/native-marquee.json) | Twenty-one recorded sessions with 51 marquee drags and the selection after each | All 21 match, selection for selection and in order. On the first recording of 18 sessions, 11 failed before the change |

[Provenance and reproduction](../../tests/fixtures/native-marquee.provenance.md).

## One earlier expectation changed

A port test expected a marquee over part of a frame, and over a rectangle beside it, to select the rectangle only. Its scene was observed natively as the last session: the group inside the frame is selected too. The test states that now and cites the fixture.

## Recorded differences

- **`select.area` is not in the port.** Native's box-selection command selects what a marquee over a box would, for the keyboard box selection and for agents. It predates this change (command inventory: Not tested) and belongs with the interface row. It is queued for the final audit; when it is ported it calls the same functions.
- **No focus view, board items or widgets.** Those branches of the native functions have no counterpart in the port.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/geometry.rs::marquee_select` | `marquee.ts::marqueeSelect` |
| `geometry.rs::{marquee_children,marquee_touches,path_touches_rect}` | `marquee.ts::{marqueeChildren,marqueeTouches,pathTouchesBox}` |
| Kurbo `PathSeg::intersect_line` | `marquee.ts::crosses`, on `fit-polynomial.ts::fitCubicRoots` |
| `geometry.rs::marquee_deep` | `marquee.ts::marqueeDeep` |
| `crates/engine/src/canvas/tools/pointer.rs::{marquee_within,marquee_selection}` | `canvas-selection.ts::{marqueeWithin,marqueeSelection}` |

[Property matrix](26-11-21-marquee-selection-parity.html) · [Plan](../planning/26-11-21-marquee-selection.md) · [Marquee parity](../../tests/parity/marquee.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `f66ead9`, native reference `bad07e44` |
| Failing fixtures first | 11 of the first 18 recorded sessions failed before the change |
| Older expectations | One, described above, changed on a native observation |
| Full pure suite | 5,260 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 394 cumulative Chromium cases passed in one 16.6-minute run with zero skips, retries, flakes or suite errors: the 393 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 14.98 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,688 nodes/37,205 edges at `f66ead9`; native 28,939/92,127 at `bad07e44`; combined 37,627/128,162. `marqueeSelect`, `marquee_select`, `marqueeTouches`, `marquee_touches`, `pathTouchesBox`, `path_touches_rect`, `marqueeDeep`, `marquee_deep`, `marqueeWithin` and `marquee_within` verified. |

## Verification corrections retained

- A Shift drag was first recorded starting 14 units from a selected layer's corner, where native's rotation handle is. Native turned the layer and the selection did not change; the port's replay, which drives the marquee only, cleared it. The drag now starts well away and both agree.
- A drag was first recorded starting on a rectangle inside a frame, which is a press on a layer and moves it. It was removed before the fixture was recorded.

## Reproduction

```sh
npx vitest run tests/parity/marquee.test.ts tests/parity/move-interaction.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- `select.area`, above.
- Rotated polygons, stars, lines and vectors go through the same outline test as the observed rectangle and ellipse and were not observed themselves. A section with hidden contents was not observed.
- The browser case covers a frame with one layer; the rotated outline rule is covered by the native sessions.
- Row 2 continues with item 8, the Count handle of polygons and stars.
