# Upstream delta row 3, item 3: vector region paints in .fig export

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `048e1cb`. **This bounded item passes. Fifteen items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2302 (`f1e92749`, `98f94626`) makes the `.fig` export write the paints a vector region has of its own. The port warned that they were left out.

- **Region styles.** [`writeVector`](../../src/engine/interchange/fig/export-vector.ts) gives each region with paints of its own, an empty list included, an entry of the network's style table holding them as `fillPaints`. Equal lists share one entry; a region without paints writes style 0. Points and regions share the table, points numbered first. The region's word in the network is its style above the winding bit.
- **Warning.** The warning that region paints were left out is gone. A region with a paint frame of its own gives native's `vector region paint frames were left out (their gradients and images follow the layer's box)`.

The reader already read region paints, so nothing changes on opening.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-fig-region-paints.json](../../tests/fixtures/native-fig-region-paints.json) | Eight vectors exported as `.fig` natively and reopened natively | All eight match: the port's export gives native's warnings, its style table and region styles equal native's, it reopens to the document native reopened, and the port opens native's `.fig` to that document. All eight failed before the change, the one without region paints on the warning's text |

[Provenance and reproduction](../../tests/fixtures/native-fig-region-paints.provenance.md).

## Recorded differences

- **Paint frames.** As in native, a region's paint frame is not written, with the warning above. Native's Flatten gives every region a frame, so a flattened vector warns whether or not its regions have paints.
- **Not opened in other software.** The review of exported files in an external reader stays in the handover's queue for after publication.

## Native mapping

| Native | React |
|---|---|
| `crates/format/src/fig/export/shape.rs::vector`, `style_of` | `interchange/fig/export-vector.ts::writeVector` |
| `crates/format/src/fig/export/paint.rs::paints` | `interchange/fig/export-paint.ts::FigPaintWriter.list` |
| `crates/format/src/fig/network.rs` region word | `export-vector.ts` region loop |

[Property matrix](26-11-21-fig-region-paints-parity.html) · [Plan](../planning/26-11-21-fig-region-paints.md) · [Region parity](../../tests/parity/fig-region-paints.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `048e1cb`, native reference `bad07e44` |
| Failing fixtures first | All eight native exports failed before the change |
| Full pure suite | 5,413 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 405 cumulative Chromium cases passed in one 16.2-minute run with zero skips, retries, flakes or suite errors: the 404 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.47 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,754 nodes/37,414 edges at `048e1cb`; native 28,939/92,127 at `bad07e44`; combined 37,693/128,366. `writeVector`, `FigPaintWriter`, `fig-region-paints` and `style_of` verified. |

## Reproduction

```sh
npx vitest run tests/parity/fig-region-paints.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- Paint frames are not written, as in native.
- An image paint in a region was not observed; it takes the same paint writer as a layer's image fill.
- Row 3 continues with item 4, a vector point's radius on `.fig` import.
