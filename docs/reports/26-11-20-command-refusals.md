# Upstream delta row 2, item 5: command parameter refusals

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `02cfbe5`. **This bounded item passes. Fourteen items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Seven small upstream changes (`04a6c76a` #2303, `0ff3a368`, `82da8f51`, `10d97e27`, `6222fce8`, `db1bec08`, `386c6c1d`) turn a silent fallback into an error. The port had the fallbacks.

- **`node.set` number properties.** A `miterLimit` ([stroke.ts](../../src/engine/stroke.ts)), `cornerSmoothing` ([corners.ts](../../src/engine/corners.ts)), `paragraphSpacing` or `paragraphIndent` ([text-properties.ts](../../src/engine/text-properties.ts)) that is not a number is refused and the call changes nothing. Before, the limit fell back to 4 and the others to 0.
- **`node.reparent` index.** [structure.ts](../../src/engine/structure.ts) refuses a negative or fractional index and takes `null` as no index. Before, it cut 1.5 to 1, raised -1 to 0 and refused `null`.
- **`image.savePreset` index.** [image-commands.ts](../../src/engine/image-commands.ts) checks the index the same way. Before, it cut a fraction and ignored a negative or unreadable index.
- **Export sizes.** [`exportSize`](../../src/engine/export-area.ts) takes a plain decimal with an optional `x`, `w` or `h`. A sign and an exponent are refused. Before, `+2x` and `2e0x` were accepted.
- **Export ids.** [`checkExportTargets`](../../src/engine/export-area.ts) checks a layer named by `ids` or `id` for `file.export` and `file.exportLayers`: it must be a layer id of a layer that exists. Before, a bad id was dropped and the whole page exported in its place.

`file.openRecent` needed no change: the browser keeps no recent files, so the port already refuses every index.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-command-refusals.json](../../tests/fixtures/native-command-refusals.json) | Six command sequences, 106 steps, 48 of them refused, with every receipt | All six match: each refused step is refused and leaves the document unchanged, and every `node.get`, `file.export` and `image.savePreset` receipt is equal, the exported SVG byte for byte. All six failed before the change |

[Provenance and reproduction](../../tests/fixtures/native-command-refusals.provenance.md).

## Earlier expectations changed

Three port tests pinned the fallbacks that upstream replaced. Each now states the observed refusal and cites the fixture.

- `corners.test.ts`: a `cornerSmoothing` that is not a number was expected to reset smoothing to 0.
- `stroke.test.ts`: a `miterLimit` that is not a number was expected to fall back to 4.
- `image-commands.test.ts`: `image.savePreset` with index 1.5 was expected to read the paint at index 1.

## Recorded differences

- **Error texts** follow the port's convention, without the command prefix and the backticks, and name the same key and cause. An id refusal shows the value given, cut to forty characters, as native's does.
- **Paragraph values.** Native has no `node.get` field for `paragraphSpacing` and `paragraphIndent`. That an accepted value is kept at zero or above restates `cmd/props.rs`; it is not an observation.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/props.rs` `miterLimit`, `cornerSmoothing`, `paragraphSpacing`, `paragraphIndent` | `stroke.ts`, `corners.ts::setCorners`, `text-properties.ts::applyProperty` |
| `crates/engine/src/cmd/edit/props.rs` `node.reparent`, `automation/params.rs::opt_index` | `structure.ts` `node.reparent`, `parameters.ts::parseIndex` |
| `crates/doc/src/props.rs::ExportSize::parse` | `export-area.ts::exportSize` |
| `crates/engine/src/cmd/file/export.rs::export_targets`, `automation/params.rs::{req_targets,shown}` | `export-area.ts::{checkExportTargets,shown}`, called by `editor.ts` |
| `crates/engine/src/cmd/image.rs::save_preset` | `image-commands.ts::editImagePreset` |
| `crates/engine/src/cmd/file/open.rs` `file.openRecent` | `workspace.ts` (refuses every index) |

[Property matrix](26-11-20-command-refusals-parity.html) · [Plan](../planning/26-11-20-command-refusals.md) · [Refusal parity](../../tests/parity/command-refusals.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `02cfbe5`, native reference `bad07e44` |
| Failing fixtures first | All six sequences, the error-text case and the paragraph case failed before the change |
| Older expectations | Three, described above, changed on native observations |
| Full pure suite | 5,209 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 392 cumulative Chromium cases passed in one 16.5-minute run with zero skips, retries, flakes or suite errors: the 391 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 14.64 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,651 nodes/36,992 edges at `02cfbe5`; native 28,939/92,127 at `bad07e44`; combined 37,590/127,953. `checkExportTargets`, `export_targets`, `req_targets`, `exportSize`, `setCorners`, `editImagePreset`, `save_preset`, `parseIndex` and `opt_index` verified. |

## Reproduction

```sh
npx vitest run tests/parity/command-refusals.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- `file.exportLayers` was observed for the refusals only.
- `file.openRecent` was not observed natively: the port has no recent files to open.
- The browser case covers the export size. The other refusals are reached by commands, not by a panel, and are covered by the native sequences.
- Row 2 continues with item 6, the vector edit clipboard.
