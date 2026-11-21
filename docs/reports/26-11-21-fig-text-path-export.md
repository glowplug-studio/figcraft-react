# Upstream delta row 3, item 5: text on a path in .fig export

21 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `5e0f123`. **This bounded item passes. Thirteen items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2323 (`88b63d1e`, `a243f0b8`, `193c3a35`) makes the `.fig` export write text on a path as the format's own layer kind. The port wrote plain text with a warning, so the path, the start and the side were gone on reopening.

- **The layer.** [`textPathFields`](../../src/engine/interchange/fig/export-text-path.ts) builds the path's first part as a vector network with the start segment marked, and the start as that segment's parameter. [write-document.ts](../../src/engine/interchange/fig/write-document.ts) then writes the layer as `TEXT_PATH` with `textAlignVertical` TOP. The [schema](../../src/engine/interchange/fig/export-schema.ts) gains the layer kind, `TextPathStart` and field 432.
- **What stays plain text.** Text of more than one line, and a path the format cannot hold, each with native's warning. Later parts of a path are left out with a warning.
- **Instances.** An override row follows its main's layer. When the instance's text and the main's differ in being on a path in the file, the row is written as the main has it, with native's warning; an instance text of more than one line on a main's path gets its own wording.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-fig-text-path-export.json](../../tests/fixtures/native-fig-text-path-export.json), `cases` | Eight texts on paths exported as `.fig` natively and reopened natively | All eight match: native's warnings, the same layer kind, side and alignment, a network equal to native's byte for byte, the start's parameter to a millionth, and the same document after reopening with the start to a millionth. All eight failed before the change |
| The same file, `instances` | Three components with an instance | All three match in warnings, their order and the reopened document; the port also opens native's files to those documents. All three failed before |
| The same file, `repinned` | Six drawings of the older text corpus exported and reopened natively at the pin | All six match |

[Provenance and reproduction](../../tests/fixtures/native-fig-text-path-export.provenance.md).

## Earlier expectations changed

`fig-export.test.ts` compares the port's export of each drawing of the older text corpus with native's export of it, recorded before this upstream change. Six of the 32 are texts on paths the format can hold; their records have plain text and the old warning. They were exported and reopened natively again at `bad07e44`, and the test compares those six with the new observations. The corpus files are unchanged.

## Recorded differences

- **The start's last digits.** Native measures with kurbo's arc length and its inverse; the port with its own adaptive measure and a bisection. The file holds the parameter as a 32-bit number. Both are compared to a millionth: the largest difference seen was below that in every case.
- **An instance on a path over a main that is not.** Native refuses `text.onPath` inside an instance, so this direction was reached only through a main of two lines. The other wording of the mismatch warning is observed.
- **Not opened in other software.**

## Native mapping

| Native | React |
|---|---|
| `crates/format/src/fig/export/shape.rs::text_path` | `interchange/fig/export-text-path.ts::textPathFields` |
| `text_path_net`, `path_chain`, `net_cubic`, `net_length` | `textPathNet`, `pathChain`, `netCubic`, `netLength` |
| `crates/format/src/fig/export/layer.rs` layer kind and vertical alignment | `interchange/fig/write-document.ts::writeLayer` |
| `crates/format/src/fig/export.rs` schema | `interchange/fig/export-schema.ts` |

[Property matrix](26-11-21-fig-text-path-export-parity.html) · [Plan](../planning/26-11-21-fig-text-path-export.md) · [Text path parity](../../tests/parity/fig-text-path-export.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `5e0f123`, native reference `bad07e44` |
| Failing fixtures first | All eleven native cases failed before the change |
| Older expectations | Six, described above, changed on native observations at the pin |
| Full pure suite | 5,433 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 407 cumulative Chromium cases passed in one 16.4-minute run with zero skips, retries, flakes or suite errors: the 406 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 13.66 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,781 nodes/37,513 edges at `5e0f123`; native 28,939/92,127 at `bad07e44`; combined 37,720/128,460. `textPathFields`, `writeLayer`, `text_path_net` and `path_chain` verified. |

## Reproduction

```sh
npx vitest run tests/parity/fig-text-path-export.test.ts tests/parity/fig-export.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- A path the format cannot hold, other than text of two lines, was not observed natively: the checks for an axis without extent and a path the renderer cannot measure restate `text_path_net`.
- A network too large for the format (more than 200,000 points and segments) was not observed.
- The start is compared to a millionth, above.
- Row 3 continues with item 6, lists in `.fig` files and in the text editor.
