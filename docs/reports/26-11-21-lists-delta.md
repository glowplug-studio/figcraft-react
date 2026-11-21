# Upstream delta row 3, item 6: lists in .fig files and in the text editor

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `ea403f6`. **This bounded item passes. Twelve items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Six upstream commits (`a4e33077` #2305, `bb480bdf` and `4e9b414c` #2273, `b190e675`, `7c3f9ce7`, `b8f05d19`) change how a numbered list starts, in the editor and in files, and what the `.fig` export writes for a text's list settings.

- **A typed number.** [`typedListMarker`](../../src/engine/text-edit.ts): a number from 1 to 9999 with a full stop and a space at the start of a plain paragraph starts a numbered list at that number. Before, only `1. ` did, at 1.
- **Enter.** [`editTextRange`](../../src/engine/text-edit.ts) gives every paragraph an insertion makes no start of its own ([`clearListStarts`](../../src/engine/text-ranges.ts)). Before, Enter copied the item's start, so after a middle item left the list the next one restarted at the copied start.
- **Reading a file.** The REST and `.fig` reader ([text.ts](../../src/engine/interchange/rest/text.ts)) keeps a start only on the item where a numbered list starts counting ([`keepListStartsWhereCountingStarts`](../../src/engine/text-ranges.ts)). Before, it kept every line's value. The marker layout ([text-list-layout.ts](../../src/engine/text-list-layout.ts)) now counts by the same function; its numbers are unchanged.
- **Writing a .fig.** [export-text.ts](../../src/engine/interchange/fig/export-text.ts) writes `listSpacing`, `hangingPunctuation`, `hangingList` and `leadingTrim`, each only off its default, and an instance override back to the default writes the default ([export-instance.ts](../../src/engine/interchange/fig/export-instance.ts)). The warning is now `OpenType features were left out`, for features only.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-lists.json](../../tests/fixtures/native-lists.json), `typing` | Eleven sequences typed through the text commands | All eleven give native's characters, list kinds, starts and levels. Four failed before the change: the list typed at 5 with and without the split, 9999 and 3 after a plain paragraph |
| The same file, `exports` | Ten drawings exported as `.fig` natively and reopened natively | All ten match in warnings, the four fields as written, the reopened document and the reopened texts' list fields; the port also opens native's files to those documents. Nine failed before the change |
| The same file, `repinned` | One drawing of the older REST corpus exported and reopened natively at the pin | Matches |

[Provenance and reproduction](../../tests/fixtures/native-lists.provenance.md).

## Earlier expectation changed

`fig-export.test.ts` compares the port's export of each REST corpus drawing with native's, recorded before this upstream change. The drawing "text layout" sets all four fields; its record has them left out. It was exported and reopened natively again at `bad07e44`, where the fields are kept, and the test compares this one drawing with the new observation. The corpus file is unchanged.

## Recorded differences

None in behaviour. The start-number rules for `0. ` and a bracket after a number other than 1 are, as upstream says, not measured in the other app; the port follows native.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/canvas/textedit.rs::insert_model` | `text-edit.ts::{typedListMarker, editTextRange}` |
| `crates/doc/src/text.rs::{list_item_starts_counting, keep_list_starts_where_counting_starts, clear_list_starts}` | `text-ranges.ts::{listItemStartsCounting, keepListStartsWhereCountingStarts, clearListStarts}` |
| `crates/format/src/rest/text.rs` | `interchange/rest/text.ts` |
| `crates/text/src/layout.rs` list numbering | `text-list-layout.ts::TextListLayout` |
| `crates/format/src/fig/export/shape.rs` four fields; `export/common.rs` defaults | `interchange/fig/export-text.ts`; `export-instance.ts` `clears`; `export-schema.ts` |

[Property matrix](26-11-21-lists-delta-parity.html) · [Plan](../planning/26-11-21-lists-delta.md) · [List parity](../../tests/parity/lists-delta.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `ea403f6`, native reference `bad07e44` |
| Failing fixtures first | Thirteen of the 21 native cases failed before the change |
| Older expectations | One, described above, changed on a native observation at the pin |
| Full pure suite | 5,454 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 408 cumulative Chromium cases passed in one 16.5-minute run with zero skips, retries, flakes or suite errors: the 407 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.96 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,792 nodes/37,558 edges at `ea403f6`; native 28,939/92,127 at `bad07e44`; combined 37,731/128,502. `typedListMarker`, `listItemStartsCounting`, `keepListStartsWhereCountingStarts`, `clearListStarts`, `list_item_starts_counting` and `clear_list_starts` verified. |

## Reproduction

```sh
npx vitest run tests/parity/lists-delta.test.ts tests/parity/fig-export.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- A REST file with a start on every line was not opened directly; the same reader function serves `.fig` and REST, and the `.fig` cases carry the start on every line.
- Nested levels in a `.fig` export are still written as the first level, with the existing warning, as in native.
- Row 3 continues with item 7, a wrap style per paragraph.
