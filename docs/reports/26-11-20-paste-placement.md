# Upstream delta row 2, item 2: paste placement and stacking

20 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `893d8a5`. **This bounded item passes. Seventeen items of row 2, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream `c74bcd0b` changed where Paste over selection (Shift+Cmd/Ctrl+V) puts its copies. They still go into the selected layer's parent at its top-left, but now sit just above the selected layer, in the copied order. Before, they were appended: on top of every layer of the parent, and in an auto layout frame at the end of the flow.

[`pasteLayers`](../../src/engine/layer-clipboard.ts) now inserts the copies at the selected layer's index plus one. Paste to replace already kept the replaced layer's place, and plain Paste is unchanged.

Upstream `476daeab` added tests for where plain Paste lands, as measured in the target application. The port already followed all four rules; they are now pinned by native observations.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-paste-placement.json](../../tests/fixtures/native-paste-placement.json) | Eleven command sequences: seven paste-over cases and four plain paste placements, each with the parent's children and the copies' positions | All eleven match receipt for receipt. Five paste-over cases failed before the change; the four placements and two paste-over cases already matched |

[Provenance and reproduction](../../tests/fixtures/native-paste-placement.provenance.md).

## Ledger correction

The commit ledger had put `0ad70b95` under this item. It changes how the native panel's paint rows fall back to the layer clipboard and belongs with ledger item 3.18. It is moved there.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/edit/clipboard.rs::paste_over` | `layer-clipboard.ts::pasteLayers`, passing the index to `pasteInto` |
| `cmd/edit/clipboard.rs::paste` placement | `layer-clipboard.ts::placement` (unchanged) |

[Property matrix](26-11-20-paste-placement-parity.html) · [Plan](../planning/26-11-20-paste-placement.md) · [Paste parity](../../tests/parity/paste-placement.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `893d8a5`, native reference `bad07e44` |
| Failing fixtures first | Five of the eleven sequences failed before the change |
| Full pure suite | 5,176 passed with four workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 389 cumulative Chromium cases passed in one 1,076-second run with zero skips, retries, flakes or suite errors: the 388 earlier cases and the new signed-in workflow. No pixel fixture or screenshot baseline changed |
| Real local provider integrations | 32 passed in 15.21 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,628 nodes/36,907 edges at `893d8a5`; native 28,939/92,127 at `bad07e44`; combined 37,567/127,869. `pasteLayers`, `paste_over`, `pasteInto` and `paste_into` verified. |

## Verification corrections retained

The first native run asked `node.get` for a `parent` field, which native does not have, and every read was refused. The sequences now read the parent's `children` and each copy's `absoluteBounds`.

## Reproduction

```sh
npx vitest run tests/parity/paste-placement.test.ts
npx vitest run --maxWorkers=4
npm run typecheck
npm run preview:build
```

Then serve the production preview on port 3101 as the handover describes and run `FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test --workers=1 --retries=0` with `pdftoppm` on `PATH`. The native observations reproduce from the provenance file.

## Remaining gaps

- A section pasted over a layer in a frame goes on the page in native. A section is not created by a command, so the case was not observed; it stays with the sections work.
- Pasted ids are numbers in native receipts and strings in the port's, the recorded receipt difference.
- Row 2 continues with item 3, locked layers.
