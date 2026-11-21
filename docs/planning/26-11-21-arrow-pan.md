# Delta row 2, item 13: the arrow-key pan

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `b374bfe`: [report](../reports/26-11-21-arrow-pan.md), [matrix](../reports/26-11-21-arrow-pan-parity.html), [provenance](../../tests/fixtures/native-arrow-pan.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `65e4cf5` on `prompt/full-figcraft-port`.
- Upstream commits: `75f54e0a`, `d036eb2f` (#2106 review), `9f51517f`. Ledger item 2.9.
- Files landed: `src/engine/viewport.ts`; tests `tests/parity/arrow-pan.test.ts` (new), `viewport.test.ts`, `tests/e2e/preview.spec.ts`; fixture `native-arrow-pan.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

Upstream measured the target application at 100%: with nothing selected an arrow key pans about 64 screen pixels, and Shift about 320. `crates/engine/src/cmd/view.rs` sets `PAN_STEP_PX` to 64 (it was 20) and `PAN_BIG_STEPS` to 5 (it was ten times). `view.pan {dx, dy, big?}` moves the view's centre by that many steps divided by the zoom; each of `dx` and `dy` is held to 100 steps.

## What the port had

`viewport.ts` used 20 and 200.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/view.rs::{PAN_STEP_PX,PAN_BIG_STEPS,pan}` | `viewport.ts` `view.pan` | Twelve native sequences in `native-arrow-pan.json`; signed-in browser workflow |
| `ui-egui` arrow keys with nothing selected | `Editor.tsx::key` sending `view.pan` (unchanged) | The browser workflow |

## Hazards and known differences

- Two older port tests pinned 20 and 200. They change on the native observations.
- With a selection the arrow keys nudge the layers, as before.

## Acceptance

- All twelve native sequences match.
- A signed-in browser workflow shows 64 pixels for an arrow key and 320 with Shift.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
