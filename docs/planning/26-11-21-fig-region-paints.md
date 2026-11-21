# Delta row 3, item 3: vector region paints in .fig export

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `048e1cb`: [report](../reports/26-11-21-fig-region-paints.md), [matrix](../reports/26-11-21-fig-region-paints-parity.html), [provenance](../../tests/fixtures/native-fig-region-paints.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `c01f493` on `prompt/full-figcraft-port`.
- Upstream commits: `f1e92749` (#2302), `98f94626`. Ledger item 3.4.
- Files landed: `src/engine/interchange/fig/export-vector.ts`, `write-document.ts`; tests `tests/parity/fig-region-paints.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-fig-region-paints.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- A vector region with paints of its own, an empty list included, names an entry of the network's style table that holds them as `fillPaints` (`crates/format/src/fig/export/shape.rs`). Equal lists share one entry. A region without paints of its own writes style 0 and shows the layer's fills.
- The table is one list for points and regions: points are numbered first, regions after, each new entry taking the next number from 1.
- In the network blob a region's word is its style shifted left one bit, with the winding rule in the low bit (`fig/network.rs`).
- The warning `vector region paints were left out of the .fig export` is gone. A region with a paint frame of its own gives `vector region paint frames were left out (their gradients and images follow the layer's box)`.

## What the port had

The export warned that region paints were left out whenever a region had paints or a paint frame, and wrote style 0 for every region. The reader already read a region's `fillPaints` from the style table.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `fig/export/shape.rs::vector` region styles and `style_of` | `interchange/fig/export-vector.ts::writeVector` | The style table and each region's style equal native's in eight exports |
| `fig/export/shape.rs` paint-frame warning | `export-vector.ts` | Export warnings equal native's |
| `fig/export/paint.rs::paints` for a region's list | `export-paint.ts::FigPaintWriter.list`, passed to `writeVector` by `write-document.ts` | A gradient region and a two-paint region reopen to native's documents |

## Hazards and known differences

- **Paint frames.** Native's Flatten gives every region a paint frame, so a flattened vector warns about frames with or without region paints. The port keeps the frame on such a region and gives the same warning. A drawn path's region has no frame and exports without a warning.
- **Not opened elsewhere.** The written file was not opened in other software.

## Acceptance

- Eight native exports match in warnings, style table, region styles and the document after reopening: a drawn path's region, one region of two, two regions with equal paints, two with different paints, an empty list, two paints, a gradient, and no region paints.
- A signed-in browser workflow exports a vector with two differently painted regions as `.fig`, reopens the download and saves the document native reopened.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.
