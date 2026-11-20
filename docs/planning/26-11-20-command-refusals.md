# Delta row 2, item 5: command parameter refusals

## Execution checkpoint

- Phase: complete through Phase 7 on 20 November 2026 at `02cfbe5`: [report](../reports/26-11-20-command-refusals.md), [matrix](../reports/26-11-20-command-refusals-parity.html), [provenance](../../tests/fixtures/native-command-refusals.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `324df94` on `prompt/full-figcraft-port`.
- Upstream commits: `04a6c76a` (#2303), `0ff3a368`, `82da8f51`, `10d97e27`, `6222fce8`, `db1bec08`, `386c6c1d`. Ledger item 2.19.
- Files landed: `src/engine/stroke.ts`, `corners.ts`, `text-properties.ts`, `structure.ts`, `export-area.ts`, `image-commands.ts`, `editor.ts`; tests `tests/parity/command-refusals.test.ts` (new), `corners.test.ts`, `stroke.test.ts`, `image-commands.test.ts`, `file-tabs.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-command-refusals.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Seven small upstream changes, each found by upstream testing, turn a silent fallback into an error.

- **`node.set` `miterLimit`, `cornerSmoothing`, `paragraphSpacing`, `paragraphIndent`.** A value that is not a number is refused with "`<key>` must be a number" and the call changes nothing. Text that reads as a number and a boolean are still taken; accepted values are clamped as before (limit 1 to 100, smoothing 0 to 1, paragraph values zero or above).
- **`node.reparent` `index`.** A negative or fractional index is "`index` out of range", text that is not a number "`index` must be a number". `null` is the same as leaving it out: the layer goes to the end. An index past the end also puts it at the end.
- **`image.savePreset` `index`.** The same check. An index that names a paint which is not an image gives "pass `filters`, or select a layer with an image paint".
- **`file.openRecent` `index`.** The same check.
- **Export sizes.** A size is a plain decimal with an optional `x`, `w` or `h`, optional leading `@`, any case, surrounding spaces. A sign, an exponent, `inf` and `nan` are refused.
- **`file.export` and `file.exportLayers` ids.** When a layer is named by `ids` or `id`, each must be a layer id of a layer that exists. An entry that is not an id, an `id` that is not an id, `ids` that is not an array and a missing layer are each refused. Before, a bad id was dropped and the whole page exported in its place. With nothing named (no keys, `null`, or an empty `ids` and no `id`) the command keeps its default.

## What the port had

- `miterLimit` fell back to 4, `cornerSmoothing` to 0, and the paragraph properties to 0, as native did before.
- `node.reparent` cut a fractional index to a whole number, raised a negative one to 0, and refused `null`.
- `image.savePreset` cut a fractional index and ignored a negative or unreadable one.
- Export sizes accepted a sign and an exponent.
- `file.export` and `file.exportLayers` dropped a bad id and exported the page.
- `file.openRecent` already refuses every index: the browser keeps no recent files.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/props.rs` `miterLimit`, `cornerSmoothing` | `stroke.ts` `miterLimit`, `corners.ts::setCorners` | `native-command-refusals.json`, first sequence |
| `cmd/props.rs` `paragraphSpacing`, `paragraphIndent` | `text-properties.ts::applyProperty` | Second sequence; stored values restate the source |
| `cmd/edit/props.rs` `node.reparent` with `opt_index` | `structure.ts` `node.reparent` with `parseIndex` | Third sequence, with the frame's children after each call |
| `doc/src/props.rs::ExportSize::parse` | `export-area.ts::exportSize` | Fourth sequence; signed-in browser workflow |
| `cmd/file/export.rs::export_targets`, `automation/params.rs::{req_targets,shown}` | `export-area.ts::{checkExportTargets,shown}`, called by `editor.ts` for `file.export` and `file.exportLayers` | Fifth sequence, with byte-equal SVG for the accepted forms |
| `cmd/image.rs::save_preset` | `image-commands.ts::editImagePreset` | Sixth sequence |
| `cmd/file/open.rs` `file.openRecent` | `workspace.ts` (refuses every index) | `file-tabs.test.ts` |

## Hazards and known differences

- Three older port tests pinned the fallbacks (`corners.test.ts`, `stroke.test.ts`, `image-commands.test.ts`). They change on the native observations.
- A whole-file export (`fig`, `penpot`) does not check ids, as in native, where it returns before the targets are read.
- The id check is at the command. The panels call the export functions with ids they hold, which are valid.
- Error texts follow the port's convention, without the command prefix and backticks, and name the same cause.
- Native has no `node.get` field for the paragraph properties, so their stored values after an accepted call restate `cmd/props.rs` and are not observations.

## Acceptance

- All six native sequences match: every refused step is refused and changes nothing, and every `node.get`, `file.export` and `image.savePreset` receipt is equal.
- The three older expectations state the observed behaviour.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
