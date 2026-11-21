# Delta row 3, item 1: a page's prototype background in .fig files

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `fc7d9a3`: [report](../reports/26-11-21-fig-prototype-background.md), [matrix](../reports/26-11-21-fig-prototype-background-parity.html), [provenance](../../tests/fixtures/native-fig-prototype-background.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `9b9df61` on `prompt/full-figcraft-port`.
- Upstream commits: `fb9df220` (#2326, #2328). Ledger item 3.5.
- Files landed: `src/engine/document.ts`, `src/engine/interchange/fig/export-schema.ts`, `write-document.ts`, `scene.ts`, `src/engine/interchange/rest/document.ts`; tests `tests/parity/fig-prototype-background.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-fig-prototype-background.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- The export writes every page's prototype background as `prototypeBackgroundColor` (field 141 of `NodeChange`, a plain colour), the default `#1E1E1E` included, so another app shows the same colour and not its own default (`crates/format/src/fig/export/layer.rs`).
- The colour is written opaque. A background that is not opaque adds the warning `a prototype background's opacity was left out`.
- The warning `prototype device settings were left out` is now only for the device, its rotation and colour, the custom size and the responsive setting.
- The import, which predates the range, reads the field as the first of `prototypeBackgrounds` (`fig/map/document.rs`); the REST reader takes the first entry, reads it opaque and treats an alpha of 0 as no background (`rest/proto.rs::page_settings`).

## What the port had

The page model and the `.figcraft` reader kept a prototype background. The `.fig` export wrote nothing for it and warned `prototype device settings were left out` whenever one was set. Neither the `.fig` reader nor the REST reader read the field, so a background was lost on opening such a file.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `fig/export.rs` schema, `prototypeBackgroundColor=141` | `interchange/fig/export-schema.ts` | The written record equals native's in three exports |
| `fig/export/layer.rs` page record and warnings | `interchange/fig/write-document.ts`, `document.ts::defaultPrototypeBackground` | Export warnings equal native's; export reopened equals native's export reopened natively |
| `fig/map/document.rs::page` | `interchange/fig/scene.ts` | The port opens native's export to the document native reopened |
| `rest/proto.rs::page_settings` background | `interchange/rest/document.ts::addPage` | Five REST files opened natively and by the port |

## Hazards and known differences

- **Device settings.** The port's page holds no prototype device yet; a `.figcraft` file with one is refused on opening, as before. So the port never has device settings to warn about. They arrive with the prototyping row.
- **No way to set the background in the port.** Native's `proto.settings` command and the prototype panel are part of the prototyping row. The port keeps a background that a file brings.
- **Reading was missing too.** The upstream change is to the export. The port also lacked the import, which native had before the range; without it the export could not be checked by reopening, so both are in this slice.

## Acceptance

- For a set, a default and a translucent background: the export's warnings and written record equal native's, the port's export reopened equals native's export reopened natively, and the port opens native's export to the same document.
- Five REST files open to the documents native opens them to.
- A signed-in browser workflow exports a drawing with a background as `.fig`, reopens the download and saves the same document native reopened.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.
