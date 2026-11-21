# Delta row 3, item 5: text on a path in .fig export

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `5e0f123`: [report](../reports/26-11-21-fig-text-path-export.md), [matrix](../reports/26-11-21-fig-text-path-export-parity.html), [provenance](../../tests/fixtures/native-fig-text-path-export.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `85c35cc` on `prompt/full-figcraft-port`.
- Upstream commits: `88b63d1e` (#2323), `a243f0b8`, `193c3a35`. Ledger item 3.1.
- Files landed: `src/engine/interchange/fig/export-text-path.ts` (new), `export-text.ts`, `export-schema.ts`, `write-document.ts`; tests `tests/parity/fig-text-path-export.test.ts` (new), `tests/parity/fig-export.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-fig-text-path-export.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- A text on a path is written as the layer kind `TEXT_PATH` (41) with `textPathStart {tValue, forward}` (field 432, message `TextPathStart`) and `vectorData` holding its path as a vector network and the layer's size as the normalized size (`crates/format/src/fig/export/shape.rs::text_path`, `export/layer.rs`). `textAlignVertical` is written as TOP.
- The network is the first part of the path as one chain or cycle (`path_chain`): points as 32-bit numbers, a curve's control points as offsets from its end points without rounding them first, a quadratic raised to a cubic, a segment shorter than a billionth dropped, a part ending on its first point closed into a cycle. The segment the text starts on carries the style mark `0x01ffffff`, and `tValue` is the start as that segment's own parameter (`text_path_net`). `forward` is false for a flipped text.
- It stays plain text, each with its own warning: more than one line; a path the format cannot hold (no segment, an axis without extent that is not flat, a path the text renderer cannot measure). Later parts of a path are left out with a warning.
- An instance's override row follows its main's layer. When one is on a path in the file and the other is not, the row is written as the main has it, with a warning; an instance text of more than one line on a main that is on a path gets its own wording.

## What the port had

The export warned `text on a path was written as plain text` and wrote an ordinary text layer. The reader already read `TEXT_PATH` layers (`interchange/fig/text-path.ts`).

## Source mapping

| Native | React | Verification |
|---|---|---|
| `export/shape.rs::text_path` and its warnings | `interchange/fig/export-text-path.ts::textPathFields` | Eight native exports and three with an instance |
| `text_path_net`, `path_chain`, `net_cubic`, `net_length` | `textPathNet`, `pathChain`, `netCubic`, `netLength` in the same file | The network's bytes equal native's in every case that goes on a path |
| `export/layer.rs` layer kind and TOP | `write-document.ts::writeLayer` | The written layer equals native's |
| `export.rs` schema: `TEXT_PATH=41`, `TextPathStart`, `textPathStart=432` | `export-schema.ts` | The file reopens |

## Hazards and known differences

- **The start's last digits.** Native finds the start's parameter with kurbo's arc length and its inverse to a billionth; the port uses its own adaptive measure and a bisection. The file holds the parameter as a 32-bit number. The parameter and the start after reopening are compared to a millionth; the path and everything else exactly.
- **Older comparisons.** Six drawings of the older text corpus were recorded when native wrote plain text. They were exported and reopened natively again at the pin, and the older test compares those six with the new observations. The corpus files are unchanged.
- **Putting an instance's text on a path.** Native refuses `text.onPath` inside an instance, so an instance on a path over a main that is not was observed only the other way round (a main of two lines).

## Acceptance

- Eight native exports match: straight, curve, a start a quarter along and flipped, a start on the second segment, quadratic, closed, two parts, two lines.
- Three instance cases match in warnings, their order and the reopened document.
- The six corpus drawings match their export and reopening at the pin.
- A signed-in browser workflow exports a flipped text on a curve as `.fig`, reopens the download and saves it on the same path.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.
