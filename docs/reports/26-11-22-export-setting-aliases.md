# Upstream delta row 3, item 8: export settings read and written back, and the colour profile note

> **Draft pending the cumulative verification gate.** See the [handover](../planning/26-11-07-full-port-resume.md#continue-from-here).

22 November 2026 · Reviewed 24 November 2026 · Branch `prompt/full-figcraft-port-pending` · Native reference `bad07e4433240cad046589129c084bd2fc36f097` · React command and dialog implementation `d984c1a` · Archive correction in the review working tree based on `906fee8`.

## Implemented boundary

- **Export settings.** Upstream `6c3ac0c5` and `3f39154a` let `node.set` take back what `node.get` returns. [`readExportSettings`](../../src/engine/export-settings.ts) now snake-cases every key of a `node.set` setting, nested `print` included, and reads the snake_case names as the fields' aliases. The camelCase form with its nested `print`, and the snake_case form, both store every field. Where both spellings are given the snake_case one wins. Before, every key with a capital letter was dropped, as native did before the change.
- **Opening a native document.** The archive reader accepts the declared top-level and nested `print` aliases and ignores unknown keys. It refuses simultaneous canonical and alias spellings of a field. The file-format wrapper preserves the duplicate-field reason and the open leaves the active document unchanged. Accepted settings survive canonical save and reopen. [Reader](../../src/engine/export-settings.ts) · [File format](../../src/engine/file-format.ts).
- **The note.** Upstream `016dba8c`: with Display P3 chosen, the [Color profile dialog](../../src/ColourProfileDialog.tsx) says `The canvas previews colors in sRGB; PNG, JPG and WebP exports that use the file's profile are tagged Display P3.` Before, it said only that the canvas previews colors in sRGB.

Upstream `297426c5`, `97f086e0`, `12ade9c7` and `3d4c798f` reword command descriptions, documents and one translation and change no behaviour the port has.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-export-setting-aliases.json](../../tests/fixtures/native-export-setting-aliases.json), `cases` | Eight command sequences, with every `node.get` | All eight match. Four failed before the change; the four that show ignored keys passed already |
| The same file, `repinned` | One older sequence run again at the pin | Matches, receipts and saved settings |
| [native-export-setting-archive-aliases.json](../../tests/fixtures/native-export-setting-archive-aliases.json) | 12 accepted inputs, including individual aliases, their combined form, and controls. Nine refused alias/canonical pairs | All 21 match. Accepted inputs survive canonical save and reopen. Each refusal reports a duplicate field and preserves the current snapshot. Before the correction, 19 cases failed and two controls passed |

[Command provenance and reproduction](../../tests/fixtures/native-export-setting-aliases.provenance.md) · [Archive provenance and reproduction](../../tests/fixtures/native-export-setting-archive-aliases.provenance.md).

The note restates `crates/ui-egui/src/dialogs/color_profile.rs` at the pin; the native dialog cannot be driven headless here.

## Earlier expectation changed

One sequence of `native-export-settings.json`, "raw property defaults and options", gives camelCase keys to `node.set` and was recorded with them dropped. At `bad07e44` native keeps them. The older test compares this sequence with the new observation; the older fixture file is unchanged.

## Recorded differences

- **Descriptions.** Native's reworded descriptions belong to its command list and tool documents, which the port does not carry.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/props.rs` `exports` and `snake`; `crates/doc/src/props.rs` `ExportSetting` and `PrintSettings` aliases | `export-settings.ts::readExportSettings`, `propertyKeys` |
| `crates/doc/src/props.rs` `ExportSetting` and `PrintSettings` archive deserialisation | `export-settings.ts::{readExportSettings, archiveKeys}`; `file-format.ts::nativeExportSettings` |
| `crates/ui-egui/src/dialogs/color_profile.rs` | `ColourProfileDialog.tsx` |

[Property matrix](26-11-22-export-setting-aliases-parity.html) · [Plan](../planning/26-11-22-export-setting-aliases.md) · [Command alias parity](../../tests/parity/export-setting-aliases.test.ts) · [Archive alias parity](../../tests/parity/export-setting-archive-aliases.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `d984c1a`, native reference `bad07e44`. Archive correction in the review working tree based on `906fee8` |
| Failing fixtures first | Four of the eight sequences failed before the change |
| Older expectations | One, described above, changed on a native observation at the pin |
| Focused review | All 21 native archive cases, eight command cases, eight existing export settings cases and three wrap-style creation cases passed |
| Full pure suite | 5,498 passed in 67.76 seconds with two workers |
| Strict types / production builds | Library, test and host types passed. Both production builds passed |
| Focused Chromium | Both item workflows passed in 9.1 seconds |
| Cumulative Chromium | First attempt: 279 passed, one outdated screenshot failed, 130 did not run. Fresh gate pending |
| Real local provider integrations / fixture cleanup | Pending |
| Schema / hosted | No change or hosted call |
| Local graph | Pending |

## Browser baseline review

First cumulative attempt: 279 passed, one failed, 130 did not run; 821.345 seconds, zero retries/flakes. The sole failure was the colour-profile dialog screenshot still expecting the old shorter note. Expected/actual/diff were visually reviewed against the pinned native text. Only that baseline was updated (longer note and consequent dialog/button positions); no assertion tolerance or product behaviour changed. A fresh full run is required.

## Reproduction

```sh
npx vitest run tests/parity/export-setting-aliases.test.ts tests/parity/export-setting-archive-aliases.test.ts tests/parity/export-settings.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The note is restated from the native source, above.
- No browser case sets an export setting through `node.set`; the Export panel uses its own commands, which did not change.
- Archive checks assert the duplicate-field reason. Exact native line and column positions are outside the browser error contract.
- Row 3 continues with item 9, a background blur or glass exported on its own.
