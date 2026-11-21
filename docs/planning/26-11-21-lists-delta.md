# Delta row 3, item 6: lists in .fig files and in the text editor

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `ea403f6`: [report](../reports/26-11-21-lists-delta.md), [matrix](../reports/26-11-21-lists-delta-parity.html), [provenance](../../tests/fixtures/native-lists.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `9af41d4` on `prompt/full-figcraft-port`.
- Upstream commits: `a4e33077` (#2305, #2306), `bb480bdf` and `4e9b414c` (#2273), `b190e675`, `7c3f9ce7`, `b8f05d19`. Ledger item 3.2.
- Files landed: `src/engine/text-edit.ts`, `text-ranges.ts`, `text-list-layout.ts`, `src/engine/interchange/rest/text.ts`, `src/engine/interchange/fig/export-text.ts`, `export-instance.ts`, `export-schema.ts`; tests `tests/parity/lists-delta.test.ts` (new), `tests/parity/fig-export.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-lists.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- **A typed number.** A number from 1 to 9999 with a full stop, then a space, at the start of a plain paragraph starts a numbered list whose first item reads that number (`engine/src/canvas/textedit.rs::insert_model`). `0. `, `10000. `, `12a. ` and `2) ` stay text; `1) ` starts a list at 1 as before. Inside a list item the characters stay text.
- **Enter.** A paragraph an insertion makes has no start of its own (`TextData::clear_list_starts`). So when a middle item is taken out of the list, the next one restarts at 1 and not at a copied start.
- **Reading a file.** A numbered list keeps a start only on the item where it starts counting (`doc/src/text.rs::list_item_starts_counting`, `keep_list_starts_where_counting_starts`, called by `format/src/rest/text.rs` for `.fig` and REST). The other app writes the start on every line of the list. The layout numbers by the same rule.
- **Writing a .fig.** `listSpacing`, `hangingPunctuation`, `hangingList` and `leadingTrim` (`CAP_HEIGHT`) are written, each only off its default (`format/src/fig/export/shape.rs`). An instance override back to the default writes the default, so the instance does not take its main's value again (`export/common.rs`). The warning narrows to `OpenType features were left out`.

## What the port had

Only `1. ` and `1) ` started a numbered list, always at 1. Enter copied the item's start onto the new item. The reader kept every line's start. The export wrote none of the four fields and warned for all of them and OpenType features together.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `textedit.rs::insert_model` typed list | `text-edit.ts::typedListMarker` | Eleven native typing sequences |
| `insert_model` after a newline, `clear_list_starts` | `text-edit.ts::editTextRange`, `text-ranges.ts::clearListStarts` | The same sequences: a list typed at 5 has starts 4, 0, 0 |
| `list_item_starts_counting`, `keep_list_starts_where_counting_starts`, `rest/text.rs` | `text-ranges.ts::{listItemStartsCounting, keepListStartsWhereCountingStarts}`, `interchange/rest/text.ts` | Native exports reopened natively and by the port |
| `text/src/layout.rs` list numbering | `text-list-layout.ts::TextListLayout` | The existing marker tests |
| `fig/export/shape.rs` four fields and warning, `export/common.rs` defaults | `interchange/fig/export-text.ts`, `export-instance.ts` `clears`, `export-schema.ts` | Seven native exports, three of them with an instance |

## Hazards and known differences

- **An older comparison.** The REST corpus's drawing "text layout" sets all four fields. Its recorded native export predates the change. It was exported and reopened natively again at the pin and the older test compares this one drawing with the new observation. The corpus file is unchanged.
- **Typing goes through the text commands.** The native sequences use `text.edit.begin`, `text.edit.insert`, `text.edit.caret` and `text.edit.key`, which the port has, so the same sequences run in both.

## Acceptance

- Eleven typing sequences give native's characters, list kinds, starts and levels.
- Ten exports match in warnings, the four written fields, the reopened document and the reopened texts' list fields.
- The corpus drawing matches its export and reopening at the pin.
- A signed-in browser workflow types a list at 5, splits it with Backspace, and exports and reopens it as `.fig`.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 3 plan and the ledger.
