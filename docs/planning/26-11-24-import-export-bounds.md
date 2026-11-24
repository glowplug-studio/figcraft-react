# Delta row 3, item 10: import and export bounds

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `138f12a`: [report](../reports/26-11-24-import-export-bounds.md), [matrix](../reports/26-11-24-import-export-bounds-parity.html), [provenance](../../tests/fixtures/native-svg-import-attributes.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `4c69d65` on `prompt/full-figcraft-port`.
- Upstream commits: `9032dc3e` (#2250), `64e91207` (#2252), `70ed6c16`, `4d3fe2aa`, `cf77dfda`, `2f8dd85f`, `81371f4a` (#2254). Ledger item 3.17.
- Files changed: `src/engine/export-svg.ts`, `svg-import/xml.ts`, `svg-import/filter.ts`, `interchange/penpot/raw-svg.ts`; tests `tests/parity/svg-image-export.test.ts`, `tests/parity/svg-import-attributes.test.ts` (new), three cases in `tests/e2e/raster-export.spec.ts` with helpers in `tests/fixtures/raster-export.ts`, `svg-import-limits.ts` and `svg-attribute-documents.ts` (new); four fixtures with provenance.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Blockers: none.

## Native contract

- **SVG export** (`svg/src/lib.rs`, `9032dc3e`): each image's bytes go in once per file, as an `<image>` in `defs` that every paint of it uses through `<use href="#…"/>` inside its own `<pattern>`. The pattern's id is taken before the image's; the image's definition goes just before its first pattern.
- **SVG import attributes** (`svg/src/import.rs::scan`, `4d3fe2aa`, `70ed6c16`): before parsing, an element with more than 4,096 attributes (counted as quoted values), or attribute work above 2²⁸ over the whole file (the sum of each element's count squared; a DTD to its `]>` counts as one element), is refused with `SVG import failed: an element has more than 4096 attributes`. This is checked before the nesting limit.
- **Filter layer stack** (`svg/src/import/fx.rs`, `64e91207`): a filter whose layer stack passes 64 layers is not expressed as effects; the layer is drawn without it, with the existing warning.
- **Penpot raw SVGs** (`engine/src/cmd/file/load.rs`, `2f8dd85f`, `cf77dfda`): all of a file's raw SVG placeholders share one allowance of 100,000 layers. Once it is used up, or when one would add more than is left, that placeholder keeps its markup, is marked `not-expanded` and gets the note `Penpot SVG '<name>': not converted, the file's SVG layers are over the limit; the original markup is preserved`. One that is taken out again has used its node ids.
- **Performance only**: span offsets mapped to characters in one pass (`svg/src/import/text.rs`), font-run coverage summed once (`load.rs::has_uncovered`), the render cache's node-id hash seeded and mixed and the pattern cell allocation skipped past the limit (`render/src/draw.rs`, `pattern.rs`, `81371f4a`). These change no observable result; the port has no counterpart to the native hash map or cell allocation.

## What the port had

The SVG writer wrote each image inside its pattern, so three paints of one image carried its bytes three times. The pre-parse scan checked nesting only. The filter stack cap was 1,024. Penpot raw SVGs each expanded within the SVG importer's own limits, with no allowance across the file.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `svg/src/lib.rs` image paints | `export-svg.ts` `images` map | Five native SVG files compared as text |
| `svg/src/import.rs::{scan, too_wide}` | `svg-import/xml.ts::checkSvgNesting`, `maxSvgAttributes`, `maxSvgAttributeWork` | Eight native imports, unit and browser |
| `svg/src/import/fx.rs` `MAX_STACK` | `svg-import/filter.ts` `maxStack` | Four native imports in the browser |
| `engine/src/cmd/file/load.rs::expand_penpot_raw_svgs_within` | `interchange/penpot/raw-svg.ts::RawSvgLayers.expand`, `maxPenpotSvgLayers` | Two native Penpot files in the browser |

## Acceptance

- Each native observation matches; each new case fails without its change, apart from the controls that passed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
