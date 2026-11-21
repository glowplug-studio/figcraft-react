# Upstream delta row 2, item 10: Shift while rotating

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `2c776c2`. **This bounded item passes. Nine items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `a1ac22f1` and `da81d55a` changed what Shift does while a layer is rotated by its handle. It lands the rotation on a multiple of 15 degrees; it used to step the turn by 15 from where the drag began.

- [`sharedRotationDegrees`](../../src/engine/rotation.ts) gives the rotation the dragged layers share on the page, or 0 when they differ or lie on the page's axes.
- The rotate gesture in [transform-interaction.ts](../../src/engine/transform-interaction.ts) keeps it when the drag begins and, with Shift, rounds the resulting rotation: a layer at 7 degrees turned by 37 ends at 45, where stepping the turn by 15 gives 37.
- The rotation is the one on the page, so inside a frame turned 10 degrees a layer at 7 on the page also ends at 45.
- Layers with different rotations share none, so Shift steps the turn itself, as before.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-shift-rotate.json](../../tests/fixtures/native-shift-rotate.json) | Twenty recorded rotate drags: one layer from several starting rotations, two layers that share a rotation or do not, and a layer inside a rotated frame, with and without Shift | All 20 match. Eleven failed before the change: every Shift drag that began at a rotation off the multiples of 15 |

[Provenance and reproduction](../../tests/fixtures/native-shift-rotate.provenance.md).

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/canvas/tools/handles.rs::{shared_rotation,shared_rotation_degrees}` | `rotation.ts::sharedRotationDegrees` |
| `canvas/tools/drag.rs` `Gesture::Rotate { base }` and the Shift rounding | `transform-interaction.ts` gesture `base` and the Shift rounding |

[Property matrix](26-11-21-shift-rotate-parity.html) · [Plan](../planning/26-11-21-shift-rotate.md) · [Rotation parity](../../tests/parity/shift-rotate.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `2c776c2`, native reference `bad07e44` |
| Failing fixtures first | 11 of the 20 sessions failed before the change |
| Full pure suite | 5,342 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 397 cumulative Chromium cases passed in one 16.1-minute run with zero skips, retries, flakes or suite errors: the 396 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.36 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,705 nodes/37,282 edges at `2c776c2`; native 28,939/92,127 at `bad07e44`; combined 37,644/128,239. `sharedRotationDegrees`, `shared_rotation_degrees`, `shared_rotation` and `TransformInteraction` verified. |

## Reproduction

```sh
npx vitest run tests/parity/shift-rotate.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- A layer inside a rotated group was not observed; upstream's note says groups behave as frames, and the port reads the page rotation the same way for both.
- A flipped layer and a moved rotation origin were not observed with Shift.
- The cursor that turns with the pointer during a rotate drag is not part of this item.
- Row 2 continues with item 11, the Scale tool.
