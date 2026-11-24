# Upstream delta row 3, item 8: export settings read and written back, and the colour profile note

> **Draft.** The implementation is committed at `d984c1a` on the local branch `prompt/full-figcraft-port-pending`. The cumulative browser gate has not passed yet, so the tokens in capitals below (`IMPLEMENTATION_COMMIT` and the result tokens in the final verification table) are placeholders, and the bold pass statement and the results that depend on the gate are expectations, not results. The property matrix link resolves only once the matrix is generated after the gate. Fill them and remove this note when the gate passes; see the [handover](../planning/26-11-07-full-port-resume.md#continue-from-here).

22 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `IMPLEMENTATION_COMMIT`. **This bounded item passes. Ten items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

- **Export settings.** Upstream `6c3ac0c5` and `3f39154a` let `node.set` take back what `node.get` returns. [`readExportSettings`](../../src/engine/export-settings.ts) now snake-cases every key of a `node.set` setting, nested `print` included, and reads the snake_case names as the fields' aliases. The camelCase form with its nested `print`, and the snake_case form, both store every field. Where both spellings are given the snake_case one wins. Before, every key with a capital letter was dropped, as native did before the change.
- **The note.** Upstream `016dba8c`: with Display P3 chosen, the [Color profile dialog](../../src/ColourProfileDialog.tsx) says `The canvas previews colors in sRGB; PNG, JPG and WebP exports that use the file's profile are tagged Display P3.` Before, it said only that the canvas previews colors in sRGB.

Upstream `297426c5`, `97f086e0`, `12ade9c7` and `3d4c798f` reword command descriptions, documents and one translation and change no behaviour the port has.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-export-setting-aliases.json](../../tests/fixtures/native-export-setting-aliases.json), `cases` | Eight command sequences, with every `node.get` | All eight match. Four failed before the change; the four that show ignored keys passed already |
| The same file, `repinned` | One older sequence run again at the pin | Matches, receipts and saved settings |

[Provenance and reproduction](../../tests/fixtures/native-export-setting-aliases.provenance.md).

The note restates `crates/ui-egui/src/dialogs/color_profile.rs` at the pin; the native dialog cannot be driven headless here.

## Earlier expectation changed

One sequence of `native-export-settings.json`, "raw property defaults and options", gives camelCase keys to `node.set` and was recorded with them dropped. At `bad07e44` native keeps them. The older test compares this sequence with the new observation; the older fixture file is unchanged.

## Recorded differences

- **Descriptions.** Native's reworded descriptions belong to its command list and tool documents, which the port does not carry.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/props.rs` `exports` and `snake`; `crates/doc/src/props.rs` `ExportSetting` and `PrintSettings` aliases | `export-settings.ts::readExportSettings`, `propertyKeys` |
| `crates/ui-egui/src/dialogs/color_profile.rs` | `ColourProfileDialog.tsx` |

[Property matrix](26-11-22-export-setting-aliases-parity.html) · [Plan](../planning/26-11-22-export-setting-aliases.md) · [Alias parity](../../tests/parity/export-setting-aliases.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `IMPLEMENTATION_COMMIT`, native reference `bad07e44` |
| Failing fixtures first | Four of the eight sequences failed before the change |
| Older expectations | One, described above, changed on a native observation at the pin |
| Full pure suite | PURE_COUNT passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | FULL_BROWSER_RESULT |
| Real local provider integrations | PROVIDER_RESULT |
| Fixture cleanup | CLEANUP_RESULT |
| Schema / hosted | No change; no hosted call |
| Local graph | GRAPH_RESULT |

## Reproduction

```sh
npx vitest run tests/parity/export-setting-aliases.test.ts tests/parity/export-settings.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- The note is restated from the native source, above.
- No browser case sets an export setting through `node.set`; the Export panel uses its own commands, which did not change.
- Row 3 continues with item 9, a background blur or glass exported on its own.
