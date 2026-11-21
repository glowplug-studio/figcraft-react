# Delta row 3, item 4: a vector point's corner radius in .fig files

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `e0ae594`: [report](../reports/26-11-21-fig-point-radius.md), [matrix](../reports/26-11-21-fig-point-radius-parity.html), [provenance](../../tests/fixtures/native-fig-point-radius.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `f5f81e2` on `prompt/full-figcraft-port`.
- Upstream commits: `a6be897d` (#2114). Ledger item 3.8.
- Files landed: `src/engine/interchange/fig/network.ts`, `export-vector.ts`; tests `tests/parity/fig-point-radius.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-fig-point-radius.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- **Import.** A vector point whose style sets no `cornerRadius` takes the layer's `cornerRadius`, as the other app draws it (`crates/format/src/fig/map/layer.rs`). A style that sets 0 keeps the point sharp. A style's own radius wins.
- **Export.** On a vector whose layer has a corner radius, every point writes its own `cornerRadius`, 0 included, so a sharp point is still sharp when the file is read (`fig/export/shape.rs`). On a vector without a layer radius only a point with a radius above 0 writes one, as before.

## What the port had

The reader took a point's radius from its style only, so a vector rounded by its layer's radius came in sharp. The export wrote a point's radius only when above 0. The two agreed with each other, so the port's own files round-tripped; files from elsewhere did not.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `fig/map/layer.rs` point radius with the layer's as fallback | `interchange/fig/network.ts::vectorNetwork` | Two `.fig` files without point radii, opened natively and by the port |
| `fig/export/shape.rs` explicit radius on a rounded vector | `interchange/fig/export-vector.ts::writeVector` | Five native exports with their native reopening |

## Hazards and known differences

- **Scaled instances.** Native reads a point's radius at the factor of the row that carries it (upstream #2091, before the range). The port scales a row's lengths, `cornerRadius` among them, before the network is read (`instance-geometry.ts::scaledRecord`), so the layer's radius used as fallback is already at that factor. No scaled instance was observed in this slice.
- **Crafted input.** Native's export now always writes the radius, so it cannot produce a file without one. The two import files were written by the port before this change, from a drawing native saved, and then opened natively.

## Acceptance

- Five native exports match after export and reopening: sharp points on a rounded vector, a rounded vector, points with radii on a sharp vector, a point with another radius than the layer's, and a sharp vector.
- Two files whose points have no radius under a rounded layer open with every point at the layer's radius, as native opens them.
- A signed-in browser workflow shows both.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.
