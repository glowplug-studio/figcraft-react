# Upstream delta row 2, item 11: the Scale tool

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `9ee41a2`. **This bounded item passes. Eight items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Five upstream commits (`92145e6f`, `68564374`, `197a390a`, `7a8d422d`, `f0d39197`) brought the Scale tool in line with what upstream measured in the target application.

- **A handle drag pivots on the opposite handle.** [`scaleFactor`](../../src/engine/transform-handles.ts) no longer takes the origin: a drag scales about the opposite handle's point, or about the centre with Alt. Before, the origin grid's point was the pivot unless it lay on the dragged side.
- **The origin starts at the centre** and is used by the Scale field only. It started at the top left.
- **K opens the tool with the factor field focused and its text selected**, so K, 2, Enter scales by two about the centre ([ScalePanel.tsx](../../src/ScalePanel.tsx)).
- **Enter or Escape in the factor field ends the tool**, back to Move with the selection kept: Enter applies the factor first, Escape changes nothing. Ctrl+Enter and Alt+Enter apply and keep the tool. Enter in the width or height field keeps the tool, as before.
- **A selection that appears after K with nothing selected does not move the keyboard to the field.**

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-scale-tool.json](../../tests/fixtures/native-scale-tool.json) | Nine recorded sessions with 31 handle drags: five origins, corners and edges, Alt, a flip, the default origin, and a stroked rounded layer | All nine match. Seven failed before the change: the default origin, the five origin sessions and the Alt session |

[Provenance and reproduction](../../tests/fixtures/native-scale-tool.provenance.md).

The field's behaviour restates `crates/ui-egui/src/field_tests.rs` (`pressing_k_focuses_the_scale_field_with_its_text_selected`, `k_two_enter_scales_the_selection_by_two`, `escape_in_the_scale_field_closes_it_and_changes_nothing`, `ctrl_enter_in_the_scale_field_keeps_the_scale_tool`, `a_selection_after_k_does_not_move_the_keyboard_to_the_scale_field`) as a signed-in browser workflow. The native panel cannot be driven headless here.

## Earlier expectations changed

- `transform-handles.test.ts` listed scale factors with the origin as the pivot. It now restates native's own unit test of `scale_factor`, and its gesture case states the boxes of the native session "Alt scales from the centre whatever the origin".
- `pen-interaction.test.ts` read the default origin as `tl`. It reads `c`.

## Recorded differences

- **`2x` in the factor field.** Native's field reads `2x` as two. The port's is a number input. Text forms belong with the Design panel fields of the interface row.
- **The Apply scale factor button** is the port's own; it applies and keeps the tool.
- **The panel coming back.** Native refocuses the field when the Design panel returns from another tab. In the port the section is mounted while the tool is active and focuses when it mounts; there is no other tab that hides it.
- **The last digit.** One box in an older unit test differs from the round value in the sixteenth digit after an Alt scale; it compares to nine decimals.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/canvas/tools/handles.rs::scale_factor` | `transform-handles.ts::scaleFactor` |
| `canvas/tools/drag.rs` Scale tool resize | `transform-preview.ts::previewResize`, `transform-interaction.ts` |
| `crates/engine/src/session/new.rs` default origin | `editor.ts` initial `scaleAnchor` |
| `crates/ui-egui/src/panels/scale_panel.rs::section` | `ScalePanel.tsx`, `Editor.tsx` |

[Property matrix](26-11-21-scale-tool-parity.html) · [Plan](../planning/26-11-21-scale-tool.md) · [Scale parity](../../tests/parity/scale-tool.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `9ee41a2`, native reference `bad07e44` |
| Failing fixtures first | Seven of the nine sessions failed before the change |
| Older expectations | Two files, described above, changed on native evidence |
| Full pure suite | 5,351 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 398 cumulative Chromium cases passed in one 16.1-minute run with zero skips, retries, flakes or suite errors: the 397 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.92 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,708 nodes/37,286 edges at `9ee41a2`; native 28,939/92,127 at `bad07e44`; combined 37,647/128,243. `scaleFactor`, `scale_factor`, `ScalePanel`, `scaleAbout`, `scale_about` and `previewResize` verified. |

## Reproduction

```sh
npx vitest run tests/parity/scale-tool.test.ts tests/parity/transform-handles.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The differences recorded above.
- Alt+Enter was not driven in the browser; it goes through the same branch as Ctrl+Enter.
- The live readout of the factor and pivot during a drag was not observed in this item.
- Row 2 continues with item 12, Escape.
