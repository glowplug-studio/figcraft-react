# Roadmap row 16, item 2: stickies and shapes with text

25 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `d722e71`. **This bounded item passes. Items 3 to 10 of row 16, the roadmap and the full port remain unfinished.**

## Implemented boundary

Boards can now hold stickies and shapes with text made by command ([`board-commands.ts`](../../src/engine/board-commands.ts), [`board-shapes.ts`](../../src/engine/board-shapes.ts)):

- **Shapes.** `board.shape` makes one of the 23 outlines as native draws it: a frame named after the shape, holding the outline (filled with the colour and stroked in its deeper line shade) and a centred text inside the shape's text room.
- **Stickies.** `board.sticky` makes a sticky with its colour, soft shadow and auto layout, its note and, when known, its author line. `board.nextSticky` puts a sticky of the same colour beside one.
- **Colour and style.** `board.setColor` recolours stickies, shapes, connectors and ink. `board.setStyle` changes a shape's outline, text sizes (a sticky's is kept for new ones) and connectors' routing and caps.
- **Settling.** A resized shape keeps its text inside its outline.

Board commands refuse on a design file and prototyping refuses on a board, with native's words.

## Evidence

| Case | Content | Result |
|---|---|---|
| Native observation | Every shape at its default size and at 220 × 90, a short and a long sticky ([provenance](../../tests/fixtures/native-board-shapes.provenance.md)) | The port's commands give native's receipts and the same layers; the outlines match native's networks to 1e-9 |
| Native refusals | A board command on a design file, an unknown shape, out-of-range sizes, nothing selected, `nextSticky` from a page, a prototype command on a board, an unknown parameter | Reproduced word for word |
| Parity tests | Restyling a shape and its colour, the remembered sticky text size, a resized shape's text room | Pass |
| Browser | A pink sticky and a blue diamond made by the commands, drawn on the board page | Pass, by pixels; failed before |

## Recorded differences

- **Text heights.** Native's headless engine measures no text, so its observations give every text a line's height. The port measures text with its fonts, as the desktop app does, so a long note's sticky grows taller. The comparison leaves text heights and the positions that follow from them out.
- **nextSticky from a shape.** Native joins the next shape by a connector; that comes with connectors (item 4), and until then the port refuses it with a note.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/board.rs::BoardShape` (`names`, `from_id`, `path`, `text_insets`) | `board-shapes.ts` |
| `crates/engine/src/boards/board/items.rs` (`add_text`, `make_sticky`, `sticky_cmd`, `make_shape`, `shape_cmd`, `shape_padding`, `next_sticky`, `text_of`, `owner_of_text`) | `board-commands.ts` |
| `crates/engine/src/boards/board/edit.rs` (`set_color`, `set_style`), `board.rs` (`color_param`, `line_shade`, `parent_of`, `require`, `refuse_on_board`, `BoardTool`), `board/derived.rs::settle_text` | `board-commands.ts`, `editor.ts` |

[Property matrix](26-11-25-board-shapes-parity.html) · [Plan](../planning/26-11-25-board-shapes.md) · [Row plan](../planning/26-11-25-roadmap-row-16-boards.md) · [Parity](../../tests/parity/board-shapes.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `d722e71`, native reference `bad07e44` |
| Failing fixtures first | The browser case failed before |
| Full pure suite | 5,695 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 442 cumulative Chromium cases passed in one 17.6-minute run at `d722e71` with zero skips, retries, flakes or suite errors: the 441 earlier cases and the new one. No baseline changed |
| Real local provider integrations | 32 passed in 13.41 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,652 nodes/40,980 edges at `d722e71`; native 28,939/92,127 at `bad07e44`; combined 38,591/131,860. `executeBoard`, `shapePath`, `settleBoardText`, `lineShade` and `refuseOnBoard` verified. |

## Reproduction

```sh
npx vitest run tests/parity/board-shapes.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "stickies and shapes with text made" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 16 items 3 to 10.
