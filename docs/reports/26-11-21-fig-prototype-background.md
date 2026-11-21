# Upstream delta row 3, item 1: a page's prototype background in .fig files

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `fc7d9a3`. **This bounded item passes. Seventeen items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2326 (`fb9df220`) makes the `.fig` export write each page's prototype background. The port wrote nothing and did not read the field either.

- **Export.** [write-document.ts](../../src/engine/interchange/fig/write-document.ts) writes `prototypeBackgroundColor` for every page, the default `#1E1E1E` included, always opaque. A background that is not opaque adds the warning `a prototype background's opacity was left out`. The field is number 141 in the [export schema](../../src/engine/interchange/fig/export-schema.ts). The warning `prototype device settings were left out`, which the port gave for any set background, is gone: the port's page has no device settings.
- **Import.** [scene.ts](../../src/engine/interchange/fig/scene.ts) passes the field on as the first of `prototypeBackgrounds`, and the REST reader ([document.ts](../../src/engine/interchange/rest/document.ts)) takes the first entry, reads it opaque and treats an alpha of 0 as no background. Native read the field before the upstream range; the port did not, so a background was lost on opening a `.fig` or a REST file.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-fig-prototype-background.json](../../tests/fixtures/native-fig-prototype-background.json) | Three drawings exported as `.fig` natively and reopened natively: a set, a default and a translucent background | All three match: the port's export gives native's warnings, its page record holds the same colour, it reopens to the document native reopened, and the port opens native's `.fig` to that document too. All three failed before the change |
| The same file | Five REST files opened natively | All five open to the document native opens. Three failed before the change; the two without a background passed already |

[Provenance and reproduction](../../tests/fixtures/native-fig-prototype-background.provenance.md).

## Recorded differences

- **Device settings.** Native warns `prototype device settings were left out` for a device, its rotation or colour, a custom size or the responsive setting. The port's page holds none of these and refuses a `.figcraft` file that sets one, as before. The case was observed and is recorded in the fixture as `deviceWarnings`; it is not compared. It belongs to the prototyping row.
- **Setting the background.** Native's `proto.settings` command and prototype panel are not in the port. A background arrives with a file and is kept.

## Native mapping

| Native | React |
|---|---|
| `crates/format/src/fig/export.rs` schema, `prototypeBackgroundColor=141` | `interchange/fig/export-schema.ts` |
| `crates/format/src/fig/export/layer.rs` page record and warnings | `interchange/fig/write-document.ts`, `document.ts::defaultPrototypeBackground` |
| `crates/format/src/fig/map/document.rs::page` | `interchange/fig/scene.ts` |
| `crates/format/src/rest/proto.rs::page_settings` (background) | `interchange/rest/document.ts::addPage` |

[Property matrix](26-11-21-fig-prototype-background-parity.html) · [Plan](../planning/26-11-21-fig-prototype-background.md) · [Background parity](../../tests/parity/fig-prototype-background.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `fc7d9a3`, native reference `bad07e44` |
| Failing fixtures first | Six of the eight native comparisons failed before the change; the two REST files without a background passed already |
| Full pure suite | 5,397 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 403 cumulative Chromium cases passed in one 16.3-minute run with zero skips, retries, flakes or suite errors: the 402 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.66 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,741 nodes/37,370 edges at `fc7d9a3`; native 28,939/92,127 at `bad07e44`; combined 37,680/128,324. `defaultPrototypeBackground`, `writeFigDocument`, `addPage`, `page_settings` and `proto_background_tests` verified. |

## Reproduction

```sh
npx vitest run tests/parity/fig-prototype-background.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- Device settings and a way to set the background, above.
- No external application opened the exported file; that review stays in the handover's queue for after publication.
- Row 3 continues with item 2, image adjustments in `.fig` export.
