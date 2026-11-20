# Upstream delta row 2, item 4: the Rotation field's rotation on the page

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `3a1c529`. **This bounded item passes. Fifteen items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2196 (`d0379dc7`, `cc367717`, `7e748d4a`) made the Design panel's Rotation field read and write a layer's rotation on the page: its own angle plus its parents'.

- **`node.set absoluteRotation`.** [properties.ts](../../src/engine/properties.ts) takes the new key beside `rotation`. The layer is turned about its centre in page space and the result taken back into its parent's space. `rotation` stays the angle to the parent. Giving both is refused. With several layers a selected parent is turned before the layers in it, and a moved rotation origin applies as it does to `rotation`.
- **The Rotation field.** [`shownGeometry`](../../src/engine/geometry-fields.ts) gives the page rotation, so the [Geometry panel](../../src/GeometryPanel.tsx) shows it, reads Mixed when the page angles differ, and writes `absoluteRotation`. A relative edit of a Mixed field ([`editMixedGeometry`](../../src/engine/editor.ts)) now applies to each layer's page angle, parents first.

For a top-level layer the page angle is its own angle, so nothing changes there.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-absolute-rotation.json](../../tests/fixtures/native-absolute-rotation.json) | Ten command sequences with every layer's `node.get` after each `node.set` | All ten match receipt for receipt. All were refused before the change: the port had no such key |

[Provenance and reproduction](../../tests/fixtures/native-absolute-rotation.provenance.md).

The Rotation field's behaviour restates `crates/ui-egui/src/field_tests.rs` (`the_rotation_field_shows_and_sets_the_rotation_on_the_page`, its Mixed part, and `a_relative_rotation_edit_turns_a_selected_parent_before_its_child_whatever_the_selection_order`) at the function the panel reads and the engine method it calls. The native panel cannot be driven headless here.

## Recorded differences

- **Scrubbing and arrow stepping.** The native field steps with the arrow keys and scrubs in one undo step. The port's number inputs do neither. This predates the item and belongs to roadmap row 19.
- **Error texts** follow the port's convention, without the command prefix, and name the same cause.

## Also in this commit

A comment in `layer-flags.ts` described Show/Hide the wrong way round (the code and its native observation were right). It is corrected.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/props.rs` `absoluteRotation` | `properties.ts` `node.set` |
| `crates/engine/src/cmd/edit/props.rs` parents-first order and moved-origin pivot | `properties.ts` ordering and pivot |
| `crates/ui-egui/src/panels/right.rs::{rot_of,rotation_row}` | `geometry-fields.ts::shownGeometry`, `GeometryPanel.tsx` |
| `panels/right.rs` relative edit, parents first | `editor.ts::editMixedGeometry` |

[Property matrix](26-11-20-page-rotation-parity.html) · [Plan](../planning/26-11-20-page-rotation.md) · [Rotation parity](../../tests/parity/absolute-rotation.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `3a1c529`, native reference `bad07e44` |
| Failing fixtures first | All ten sequences and the field case failed before the change |
| Full pure suite | 5,201 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 391 cumulative Chromium cases passed in one 994-second run with zero skips, retries, flakes or suite errors: the 390 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 14.71 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,644 nodes/36,976 edges at `3a1c529`; native 28,939/92,127 at `bad07e44`; combined 37,583/127,937. `shownGeometry`, `editMixedGeometry`, `rot_of`, `rotation_row` and `setRotationAboutCenter` verified. |

## Reproduction

```sh
npx vitest run tests/parity/absolute-rotation.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- Scrubbing and arrow stepping, above.
- The browser case covers a layer in a rotated group; a layer in a rotated frame and the parents-first order are covered by the native sequences only.
- Row 2 continues with item 5, command parameter refusals.
