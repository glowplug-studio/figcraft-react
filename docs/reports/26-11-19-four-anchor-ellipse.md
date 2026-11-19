# Upstream delta row 1, item 3: a whole ellipse is four closed cubics

19 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `de054fa`. **This bounded item passes. Four items of row 1, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2080 (`b33da8a7`, `4118be89`) changed how a whole ellipse and each contour of a whole ring are built: four cubics through the right, bottom, left and top extremes, starting at 3 o'clock, with handle length 0.5522847498307934 of the radius, and the contour is closed. Before, native subdivided an arc by tolerance from the major axis, which gave five or six cubics at ordinary sizes, and left the contour open.

[ellipse.ts](../../src/engine/ellipse.ts) `ellipsePath` now builds the whole and ring branches the same way. Sliced ellipses, pies and arcs are unchanged. Every consumer follows through the shared builder: canvas rendering and hit-testing, stroke geometry, Flatten and vector editing, text on a path, and the SVG, PDF, Android XML and Fig exports.

Observable effects:

- an ellipse converted to a vector has four anchors;
- exported SVG and Android XML ellipse paths end with a close;
- a tall ellipse starts at 3 o'clock like any other, so text placed on it starts there too;
- text-on-a-path start fractions on an ellipse move by up to 0.0005, because length is measured along four cubics instead of five or six.

## Native observations

Sixteen export cases, one text-path case and 26 pointer decisions recorded at earlier pins disagreed with the change. None was edited by inspection. A disposable Rust oracle replayed every recorded case at `bad07e44`:

| Fixture | Replayed | Identical to the record | Changed and updated | Left as recorded |
|---|---|---|---|---|
| SVG export | 53 cases | 47 | 4: the ellipse path gains `Z` | 2 text cases: no fonts in the container |
| Android XML | 103 cases | 89 | 12: one `pathData` gains ` Z`; warnings identical | 2 text cases |
| Text-path commands | 25 cases | 13 | Case 22: only `textPath.d` | 11: font-dependent size only |
| Text-on-a-path clicks | 432 points | 360 of 360 on five other shapes, 46 of 72 on the ellipse | 26 ellipse start fractions, largest change 0.00053, no hit/miss change | 0 |

The oracle reproduced every recorded case that involves neither an ellipse nor fonts, byte for byte. With the fixtures set to the observed values, the port passed without further source change, including the 26 start fractions to twelve decimals and the text path's coordinates to nine.

[Provenance, sources and reproduction](../../tests/fixtures/native-ellipse-four-anchor.provenance.md).

## Native mapping

| Native | React | Evidence |
|---|---|---|
| `crates/geom/src/lib.rs::ellipse`, whole and ring branches | `ellipse.ts::ellipsePath` | Three native tests restated; two failed before the change |
| `geom::ReverseSubpaths` on a closed contour | `ellipse.ts::reverseCubics` and the close | Ring contour letters, inner start and first reversed end |
| `svg` and `vectordrawable` path writers | `export-svg.ts`, Android XML export | 16 re-observed cases |
| `text.onPath` with an ellipse source | `text-path-commands.ts` | Case 22 re-observed |
| `canvas/tools/click.rs::path_at` through the tool | `text-path-commands.ts::textPathAt` | 72 ellipse points re-observed |

[Property matrix](26-11-19-four-anchor-ellipse-parity.html) · [Plan](../planning/26-11-19-four-anchor-ellipse.md) · [Ellipse parity](../../tests/parity/ellipse.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `de054fa`, native reference `bad07e44` |
| Failing fixtures first | Both new native cases failed; applying the change then failed 21 cases in five files, all accounted for above |
| Older expectations | Three ellipse cases encoded the earlier native behaviour (major-axis start, open contour, 4,097 elements at astronomical sizes, area allowance 2). They now state the upstream behaviour and cite `b33da8a7` |
| Full pure suite | 4,805 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 383 cumulative Chromium cases passed in one 993.471-second run with zero skips, retries, flakes or suite errors. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 14.85 seconds, after the corrections below |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,492 nodes/36,362 edges at `de054fa`; native 28,939/92,127 at `bad07e44`; combined 37,431/127,349. `ellipsePath`, `reverse_subpaths` and `simplify_path` verified. |

## Verification corrections retained

The first provider run after the browser gate failed one case with `JWT issued at future`. It followed the oracle's Docker build, and the container clocks agreed with the host when checked moments later; the skew was not reproduced. Two immediate reruns then failed 17 and 15 cases with the hourly publication refusal. One integration case asks for one publication per hour, which clamps the shared local host bucket to 32 tokens, and the back-to-back reruns drained it. Restarting the idle local database did not renew it: the budget lives in ordinary tables and refills continuously, contrary to what the adapter README implied. After the bucket refilled, one run passed all 32. No product, test or schema changed for this; the README now states the behaviour.

A flatten receipt returns its id as a string in the port and as a number in native. That difference predates this slice and affects mutation receipts generally; it is added to the final-audit queue instead of being changed here.

## Reproduction

```sh
npx vitest run tests/parity/ellipse.test.ts tests/parity/svg-export.test.ts tests/parity/vector-drawable.test.ts tests/parity/text-path-commands.test.ts tests/parity/text-path-tool.test.ts --maxWorkers=2
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The two text export cases and eleven text-path cases could not be re-observed headless and keep their earlier records; none involves an ellipse.
- PDF and Fig exports of ellipses have no recorded native case that disagreed; they follow the shared builder and are covered by their existing reopen and page-pixel checks, not by a new native observation.
- Row 1 continues with item 4, Pencil stroke simplification (#1741).
