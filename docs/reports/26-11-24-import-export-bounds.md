# Upstream delta row 3, item 10: import and export bounds

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `138f12a`. **This bounded item passes. Eight items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Seven upstream commits bound work in SVG export, SVG import and Penpot import. Four change what a user sees; three change performance only.

- **SVG export writes each image once.** [export-svg.ts](../../src/engine/export-svg.ts) keeps one `<image>` per image key in `defs`; each paint's `<pattern>` uses it. Before, every paint of an image carried the image's bytes.
- **SVG import refuses too many attributes.** [`checkSvgNesting`](../../src/engine/svg-import/xml.ts) counts each element's attributes as quoted values before parsing. More than 4,096 on one element, or more than 2²⁸ of work over the file (a DTD counting as one element), is refused with native's message, before the nesting check.
- **A filter's layer stack is capped at 64.** [filter.ts](../../src/engine/svg-import/filter.ts): a filter whose stack would pass 64 layers is not mapped to effects, with the existing warning. Before, the cap was 1,024.
- **Penpot raw SVGs share an allowance.** [`RawSvgLayers.expand`](../../src/engine/interchange/penpot/raw-svg.ts) charges each expansion against 100,000 layers for the whole file; one that does not fit keeps its markup, is marked `not-expanded` and gets native's note.
- **Performance only.** The span-offset mapping, the font-run coverage sum and the render cache hash need no port change: they change no result, and the port has no counterpart to native's hash map or pattern cell allocation.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-svg-image-export.json](../../tests/fixtures/native-svg-image-export.json) | Five SVG exports with image paints | All five match native's text exactly, apart from native's known zero-length cubics in a stroke outline. All five failed before |
| [native-svg-import-attributes.json](../../tests/fixtures/native-svg-import-attributes.json) | Eight SVG imports at and past the attribute limits | All eight match in the pre-parse check and in the browser import, refusals leaving the document untouched. Five failed before; the three controls passed |
| [native-svg-import-filter-stack.json](../../tests/fixtures/native-svg-import-filter-stack.json) | Four SVG imports with filter stacks at the cap | All four match in warnings and effects. The 64-shadow case failed before |
| [native-penpot-svg-allowance.json](../../tests/fixtures/native-penpot-svg-allowance.json) | Two Penpot files whose raw SVGs reach the allowance | Both match in warnings, layer count, node count, next id and every placeholder's status. The 23-SVG file failed before |

Provenance: [image export](../../tests/fixtures/native-svg-image-export.provenance.md) · [attributes](../../tests/fixtures/native-svg-import-attributes.provenance.md) · [filter stack](../../tests/fixtures/native-svg-import-filter-stack.provenance.md) · [Penpot allowance](../../tests/fixtures/native-penpot-svg-allowance.provenance.md).

## Recorded differences

- **Stroke outline.** Native writes redundant zero-length cubics in a rounded stroke outline; the port does not. This is the difference `svg-export.test.ts` already records for its outside stroke.
- **The Penpot documents** are too large to keep; the fixture keeps a summary of each, including the next id.

## Native mapping

| Native | React |
|---|---|
| `crates/svg/src/lib.rs` image paints and `images` | `export-svg.ts` `SvgWriter.images` |
| `crates/svg/src/import.rs::{scan, too_wide, too_deep}` | `svg-import/xml.ts::checkSvgNesting` |
| `crates/svg/src/import/fx.rs` `MAX_STACK`, `stack` | `svg-import/filter.ts` `maxStack`, `combine` |
| `crates/engine/src/cmd/file/load.rs::expand_penpot_raw_svgs_within` | `interchange/penpot/raw-svg.ts::RawSvgLayers.expand` |

[Property matrix](26-11-24-import-export-bounds-parity.html) · [Plan](../planning/26-11-24-import-export-bounds.md) · [Image export parity](../../tests/parity/svg-image-export.test.ts) · [Attribute parity](../../tests/parity/svg-import-attributes.test.ts) · [Browser](../../tests/e2e/raster-export.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `138f12a`, native reference `bad07e44` |
| Failing fixtures first | Every new case failed before its change, apart from the controls named above |
| Full pure suite | 5,513 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 414 cumulative Chromium cases passed in one 16.9-minute run at `138f12a` with zero skips, retries, flakes or suite errors: the 411 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.86 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,848 nodes/37,736 edges at `138f12a`; native 28,939/92,127 at `bad07e44`; combined 37,787/128,680. `checkSvgNesting`, `maxSvgAttributes`, `RawSvgLayers`, `scan` and `expand_penpot_raw_svgs_within` verified. |

## Reproduction

```sh
npx vitest run tests/parity/svg-image-export.test.ts tests/parity/svg-import-attributes.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/raster-export.spec.ts -g "too many attributes|layer stack at 64|100,000-layer allowance" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- The performance-only commits have no observable result to compare.
- Row 3 continues with item 11, a font loaded with `text.loadFont` winning over built-in and installed faces.
