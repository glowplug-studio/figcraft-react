# Upstream delta row 3, item 4: a vector point's corner radius in .fig files

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `e0ae594`. **This bounded item passes. Fourteen items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2114 (`a6be897d`) reads a vector rounded by its layer's corner radius as rounded, and keeps a sharp point on such a vector sharp when it is written.

- **Import.** [`vectorNetwork`](../../src/engine/interchange/fig/network.ts) gives a point whose style sets no radius the layer's. A style that sets 0 keeps the point sharp. Before, such a vector opened with sharp points.
- **Export.** [`writeVector`](../../src/engine/interchange/fig/export-vector.ts) writes every point's own radius, 0 included, when the layer has a corner radius. Before, a radius was written only above 0, so with the new reading a sharp point on a rounded vector would have come back rounded.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-fig-point-radius.json](../../tests/fixtures/native-fig-point-radius.json), `cases` | Five vectors exported as `.fig` natively and reopened natively | All five match after the port's export and reopening, and the port opens native's `.fig` to the same documents. With the import half alone, the first failed: its sharp points came back at 8 |
| The same file, `crafted` | Two `.fig` files whose points have no radius under a rounded layer, opened natively | Both open with every point at 8, as native opens them. Both failed before the change |

[Provenance and reproduction](../../tests/fixtures/native-fig-point-radius.provenance.md).

## Recorded differences

- **Crafted input.** Native's export cannot write a point without a radius on a rounded vector any more, so the two import files were written by the port before this change and opened natively. The provenance says how.
- **Scaled instances.** Native takes the layer's radius at the factor of the row that carries it. The port scales a row's lengths before reading the network, so the fallback is at that factor too; no scaled instance was observed here.

## Native mapping

| Native | React |
|---|---|
| `crates/format/src/fig/map/layer.rs` point radius, `layer_radius` | `interchange/fig/network.ts::vectorNetwork` |
| `crates/format/src/fig/export/shape.rs` point style | `interchange/fig/export-vector.ts::writeVector` |

[Property matrix](26-11-21-fig-point-radius-parity.html) · [Plan](../planning/26-11-21-fig-point-radius.md) · [Radius parity](../../tests/parity/fig-point-radius.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `e0ae594`, native reference `bad07e44` |
| Failing fixtures first | Both import files failed before the change; with the import half in, the first export case failed until the export half |
| Full pure suite | 5,421 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 406 cumulative Chromium cases passed in one 16.3-minute run with zero skips, retries, flakes or suite errors: the 405 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.71 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,758 nodes/37,428 edges at `e0ae594`; native 28,939/92,127 at `bad07e44`; combined 37,697/128,379. `vectorNetwork`, `writeVector`, `fig-point-radius` and `sharp_points_on_a_rounded_vector_stay_sharp` verified. |

## Reproduction

```sh
npx vitest run tests/parity/fig-point-radius.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- A scaled instance's vector was not observed.
- A file from the other app itself was not used; the import files are crafted as described.
- Row 3 continues with item 5, text on a path in `.fig` export.
