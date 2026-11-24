# Upstream delta row 3, item 17: the eyedropper

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `679e2d6`. **This bounded item passes. One item of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2189 fixed how native's eyedropper samples. The port had no eyedropper, so this item ports its core with the fix in place.

- **Pick color.** `edit.pickColor {apply?}` (Edit ▸ Pick color, key I) chooses the eyedropper ([`editor.ts`](../../src/engine/editor.ts)).
- **The sample.** A press renders one screen pixel centred on the pointer as the canvas draws it, so an image magnified past 2× gives the pixel under the pointer, not a blend with its neighbours ([`sampleCanvasColour`](../../src/engine/eyedropper.ts)).
- **The result.** The colour, opaque, fills the selected layers in one undo step, the notice reads `Picked #RRGGBB`, and the Move tool comes back; with `apply: false` the colour is only kept (`pickedColour`).

## Native reference

| Case | Result |
|---|---|
| Browser fixture: native's 9 × 9 line image at 1×, 2×, 8× and 20× | 3D444D on the line and 151B23 beside it at every zoom, as native ([provenance](../../tests/fixtures/native-eyedropper.provenance.md)). A sample starting at the pointer instead of centred on it straddles two pixels at 1× |
| Unit: the command and a pick | The fill, the message, Move again, undo; `apply: false` keeps the colour and edits nothing; a pick outside the tool and an unknown parameter are refused |
| Browser: I, a click on a #3D444D layer with another selected | The selected layer takes #3D444D, the notice shows, and the next click selects |

## Recorded differences

- **Interface around the tool.** The colour picker's eyedropper button, Cmd/Ctrl+Shift colour styles, recent colours, the eyedropper cursor and the Mac's Ctrl+C key are not ported yet; they are in the handover's deferred queue.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/view.rs` `edit.pickColor` | `editor.ts` `edit.pickColor`, tool `eyedropper` |
| `crates/engine/src/canvas/tools/click.rs::eyedrop` | `eyedropper.ts::sampleCanvasColour`, `editor.ts::pickColour`, `canvas.ts` press |

[Property matrix](26-11-24-eyedropper-parity.html) · [Plan](../planning/26-11-24-eyedropper.md) · [Unit](../../tests/parity/eyedropper.test.ts) · [Browser](../../tests/e2e/eyedropper.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `679e2d6`, native reference `bad07e44` |
| Failing fixtures first | The command and tool did not exist before |
| Full pure suite | 5,539 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 421 cumulative Chromium cases passed in one 16.4-minute run at `679e2d6` with zero skips, retries, flakes or suite errors: the 419 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.36 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,907 nodes/38,065 edges at `679e2d6`; native 28,939/92,127 at `bad07e44`; combined 37,846/129,002. `sampleCanvasColour`, `pickColour`, `pickedColour`, `eyedrop` and `render_view` verified. |

## Reproduction

```sh
npx vitest run tests/parity/eyedropper.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/eyedropper.spec.ts --workers=1 --retries=0
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "Pick color with I" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- The deferred eyedropper interface above.
- Row 3 closes with item 18, Selection colors.
