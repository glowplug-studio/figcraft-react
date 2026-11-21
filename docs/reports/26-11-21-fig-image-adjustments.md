# Upstream delta row 3, item 2: image adjustments in .fig export

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `616b51c`. **This bounded item passes. Sixteen items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2297 (`b54df860`, `501df234`) makes the `.fig` export write an image paint's adjustments. The port warned that they were left out.

- **Export.** [export-paint.ts](../../src/engine/interchange/fig/export-paint.ts) writes the seven adjustments as the paint's `paintFilter`, for fills and strokes. Saturation is the file's `vibrance` and the tint's sign is turned. Each value is clamped to -1..1 and a value that is not a number is 0; when all are then 0 nothing is written. The [export schema](../../src/engine/interchange/fig/export-schema.ts) gains `PaintFilterMessage` and `Paint.paintFilter` with native's field numbers. The warning is gone.
- **Import note.** [paint.ts](../../src/engine/interchange/rest/paint.ts) notes `image filters use FigCraft's approximate renderer` when a `.fig` file's image paint has an adjustment. Native gave this note before the upstream range; the port did not.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-fig-image-adjustments.json](../../tests/fixtures/native-fig-image-adjustments.json) | Six drawings exported as `.fig` natively and reopened natively | All six match: the port's export gives native's warnings, its image paints hold the same `paintFilter`, it reopens with native's warnings to the document native reopened, and the port opens native's `.fig` the same way. Five failed before the change; the drawing without an adjustment passed already |
| The same file, `repinned` | One drawing of the older REST corpus exported and reopened natively at the pin | Matches |

[Provenance and reproduction](../../tests/fixtures/native-fig-image-adjustments.provenance.md).

## Earlier expectation changed

`fig-export.test.ts` compares the port's export of each REST corpus drawing with native's export of it, recorded before this upstream change. One drawing, "unsafe image names", has seven adjusted image paints; the record has them left out. With the port now writing them the comparison failed. The drawing was exported and reopened natively again at `bad07e44`: no export warning, the approximate-renderer note seven times on reopening, and the adjustments kept. The test compares this one drawing with the new observation; the corpus file is unchanged.

## Recorded differences

- **Not opened in other software.** Upstream says the same of its change. The review of exported files in an external reader stays in the handover's queue for after publication.

## Native mapping

| Native | React |
|---|---|
| `crates/format/src/fig/export.rs` schema: `PaintFilterMessage`, `Paint.paintFilter=14` | `interchange/fig/export-schema.ts` |
| `crates/format/src/fig/export/paint.rs` image paint; `crates/color/src/lib.rs::ImageFilters::sanitized` | `interchange/fig/export-paint.ts` |
| `crates/format/src/rest/props.rs` approximate-renderer note | `interchange/rest/paint.ts::imagePaint` |

[Property matrix](26-11-21-fig-image-adjustments-parity.html) · [Plan](../planning/26-11-21-fig-image-adjustments.md) · [Adjustment parity](../../tests/parity/fig-image-adjustments.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `616b51c`, native reference `bad07e44` |
| Failing fixtures first | Five of the six native exports failed before the change |
| Older expectations | One, described above, changed on a native observation at the pin |
| Full pure suite | 5,404 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 404 cumulative Chromium cases passed in one 16.3-minute run with zero skips, retries, flakes or suite errors: the 403 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.61 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,748 nodes/37,393 edges at `616b51c`; native 28,939/92,127 at `bad07e44`; combined 37,687/128,346. `imagePaint`, `restPaints`, `figExportSchema`, `image_filter_tests` and `sanitized` verified. |

## Reproduction

```sh
npx vitest run tests/parity/fig-image-adjustments.test.ts tests/parity/fig-export.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The written file was not opened in other software, above.
- A value that is not a number cannot be set through a command or kept by a saved file's JSON, so that half of the sanitising restates `ImageFilters::sanitized`; the out-of-range half is observed.
- Row 3 continues with item 3, vector region paints in `.fig` export.
