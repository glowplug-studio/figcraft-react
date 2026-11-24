# Delta row 3, item 8: export settings read and written back, and the colour profile note

## Execution checkpoint

- Coordinator review, 24 November: 5,498 pure tests pass, strict library/test/host types and both production builds pass, and the two focused Chromium workflows pass. The cumulative 410-case browser gate has not yet passed (the second attempt's session was lost); provider/cleanup/final graph verification are still pending. The new archive aliases and wrap creation fixtures are documented below.

- Phase: Phase 6, committed at `d984c1a` on the local branch `prompt/full-figcraft-port-pending` on 24 November 2026. The focused tests, the full pure suite (5,474) and strict library and test types pass. Not yet run: both production builds, the new browser case, the cumulative browser gate, the provider integrations, the cleanup counts and the graph refresh.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `8fedff6` on `prompt/full-figcraft-port-pending`.
- Upstream commits: `6c3ac0c5`, `3f39154a` (export settings); `016dba8c`, `3d4c798f` (the note); `297426c5`, `97f086e0`, `12ade9c7` (descriptions and documents only). Ledger item 3.16.
- Files changed: `src/engine/export-settings.ts`, `src/ColourProfileDialog.tsx`; tests `tests/parity/export-setting-aliases.test.ts` (new), `tests/parity/export-settings.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-export-setting-aliases.json` and its provenance.
- Next action: the handover's current action: one cumulative browser gate for items 7 and 8, then the records.
- Blockers: none in the product. Machine load is diagnostic only under the user's 24 November instruction; verification proceeds without a load threshold.

## Native contract

- **node.set takes back what node.get returns.** `node.set exports` (or `exportSettings`) snake-cases every key, nested ones included, before reading the settings (`engine/src/cmd/props.rs::snake`), and a setting takes the snake_case spellings of its two-word fields as aliases: `contents_only`, `include_bounding_box`, `svg_outline_text`, `svg_id_attribute`, `svg_simplify_stroke`, `vd_compat`, `color_profile`, and in `print` `crop_marks` and `bleed_marks` (`doc/src/props.rs`). So the camelCase form `node.get` returns, with its nested `print`, goes back in unchanged, and the snake_case form works too.
- **Both spellings.** Where both are given the snake_case one wins, whatever their order. An unknown key is ignored. The print keys are read from `print` only; at the top level they are ignored. `export.add` takes the camelCase names only.
- **The note.** With Display P3 chosen in the Color profile dialog, the note reads `The canvas previews colors in sRGB; PNG, JPG and WebP exports that use the file's profile are tagged Display P3.` (`ui-egui/src/dialogs/color_profile.rs`).
- The other commits reword command descriptions and documents and change no behaviour.

## What the port had

`node.set exports` dropped every key with a capital letter, as native did before the change, so the two-word fields and the print marks could not be set through it and a setting read with `node.get` lost them when written back. The note stopped after its first clause.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/props.rs` `exports` with `snake`; `doc/src/props.rs` aliases | `export-settings.ts::readExportSettings`, `propertyKeys` | Eight native command sequences |
| `ui-egui/src/dialogs/color_profile.rs` | `ColourProfileDialog.tsx` | A signed-in browser case |

## Hazards and known differences

- **An older comparison.** One sequence of `native-export-settings.json` set camelCase keys through `node.set` and recorded them dropped. It was run again at the pin and the older test compares that sequence with the new observation.
- **Descriptions.** Native's reworded export descriptions are help text for its command list; the port has no counterpart to update.

## Acceptance

- Eight native sequences match in every `node.get`.
- The older sequence matches its observation at the pin, receipts and saved settings.
- A signed-in browser case shows the note.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.

## Coordinator review correction — 24 November

Review at pending-branch `906fee8` found a second entry point covered by the same native aliases: file deserialisation. `file-format.ts` calls `readExportSettings` without property mode, so snake_case aliases inside a native document were silently ignored. Native `ExportSetting` and `PrintSettings` derive Serde aliases for all deserialisation, not just `node.set`. Verify with independently observed file-open receipts before correcting the archive reader.

Keep the two contracts distinct: `node.set` first snake-cases/sorts keys and resolves duplicate spellings by the existing command transformation; an archive accepts either spelling but native Serde refuses both spellings of the same field. Unknown archive fields remain ignored, and command-only names are not introduced into the archive format. Add immutable native input/receipt fixtures and file-open plus open/save/reopen assertions; retain the eight command sequences unchanged. No provider/schema change is required. The 410-case gate remains pending until both items and this correction pass.
