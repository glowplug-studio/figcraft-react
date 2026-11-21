# Delta row 3, item 2: image adjustments in .fig export

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `616b51c`: [report](../reports/26-11-21-fig-image-adjustments.md), [matrix](../reports/26-11-21-fig-image-adjustments-parity.html), [provenance](../../tests/fixtures/native-fig-image-adjustments.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `7b3ad0f` on `prompt/full-figcraft-port`.
- Upstream commits: `b54df860` (#2297), `501df234`. Ledger item 3.3.
- Files landed: `src/engine/interchange/fig/export-schema.ts`, `export-paint.ts`, `src/engine/interchange/rest/paint.ts`; tests `tests/parity/fig-image-adjustments.test.ts` (new), `tests/parity/fig-export.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-fig-image-adjustments.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- An image paint's adjustments (exposure, contrast, saturation, temperature, tint, highlights, shadows) are written as the paint's `paintFilter` (`crates/format/src/fig/export/paint.rs`), in fills and strokes alike. The schema gains `PaintFilterMessage` (tint 1, shadows 2, highlights 3, exposure 5, temperature 7, vibrance 8, contrast 9) and `Paint.paintFilter` (14).
- The file calls saturation `vibrance`. Its tint is positive towards magenta, the document's towards green, so the sign is turned.
- Values are written within the file's range: each is clamped to -1..1 and a value that is not a number is 0 (`ImageFilters::sanitized`). When every value is then 0, no `paintFilter` is written. When one is set, all seven are written.
- The warning `image adjustments (exposure, contrast, …) were left out` is gone.
- On opening a `.fig` whose image paint has an adjustment, the reader notes `image filters use FigCraft's approximate renderer` (`rest/props.rs`). This predates the range.

## What the port had

The export warned that the adjustments were left out and wrote none. The reader already read `paintFilter`, with the name and sign turned back, but did not give the approximate-renderer note, though the note's text was in its list of known notes.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `fig/export.rs` schema: `PaintFilterMessage`, `Paint.paintFilter=14` | `interchange/fig/export-schema.ts` | The written paints equal native's in six exports |
| `fig/export/paint.rs` image paint, `ImageFilters::sanitized` | `interchange/fig/export-paint.ts` | Export warnings and written paints equal native's; the export reopened equals native's export reopened natively |
| `rest/props.rs` approximate-renderer note | `interchange/rest/paint.ts::imagePaint` | Warnings on reopening equal native's, for the port's export and for native's |

## Hazards and known differences

- **An older comparison.** The REST corpus's drawing "unsafe image names" has seven adjusted image paints. Its recorded native export predates the change and left them out, so the port's export, which now writes them, no longer reopened to that record. The drawing was exported and reopened natively again at the pin and the older test compares this one case with the new observation. The corpus file is unchanged.
- **Not opened elsewhere.** As upstream says of its own change, the written file was not opened in other software.

## Acceptance

- Six native exports match: every adjustment, none, one, a preset, a value out of range set through a fills property, and a stroke's image.
- The corpus drawing with adjustments matches its export and reopening at the pin.
- A signed-in browser workflow exports a drawing with an adjusted image as `.fig`, reopens the download and saves the document native reopened.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.
