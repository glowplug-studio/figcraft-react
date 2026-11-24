# Roadmap row 15, item 7b: a layer's overflow and scroll position

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `e28d7c0`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

A frame's overflow says which axes its content scrolls in a prototype, and a layer's scroll position keeps it fixed or sticky while its frame scrolls. The port had neither: `node.set` refused them and opening a file that set either failed. Layers now carry both ([`document.ts`](../../src/engine/document.ts)), `node.set` sets them by name in any case with native's refusals ([`properties.ts`](../../src/engine/properties.ts)), and files keep them, written only when not the default ([`file-format.ts`](../../src/engine/file-format.ts)).

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-layer-scrolling.json](../../tests/fixtures/native-layer-scrolling.json) | Overflow and scroll position set, refused and reset, with two saves | Every refusal and saved value matches, and the saves open again with the same values. Failed before |
| Browser: the first save opened in the editor and saved | Overflow and sticky scroll position kept | Passes; the file was refused before |

Provenance: [a layer's overflow and scroll position](../../tests/fixtures/native-layer-scrolling.provenance.md).

## Recorded differences

- **Interchange.** `.fig`, Penpot and REST imports and exports do not yet carry these fields; that belongs with the presenter and its interchange checks.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/node.rs::{Overflow, ScrollPosition}` | `document.ts` `LayerProperties.overflow`, `scrollPosition`; `file-format.ts` |
| `crates/engine/src/cmd/props.rs` (`overflow`, `scrollPosition`) | `properties.ts` |

[Property matrix](26-11-24-layer-scrolling-parity.html) · [Plan](../planning/26-11-24-layer-scrolling.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/layer-scrolling.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `e28d7c0`, native reference `bad07e44` |
| Failing fixtures first | The parity and browser cases failed before |
| Full pure suite | 5,612 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 431 cumulative Chromium cases passed in one 18.5-minute run at `e28d7c0` with zero skips, retries, flakes or suite errors: the 430 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.66 seconds, run once after the browser gates of items 7b and 7c |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,176 nodes/39,038 edges at `e28d7c0`; native 28,939/92,127 at `bad07e44`; combined 38,115/129,953. `scrolling`, `supportsLayerProperty`, `setRectangleProperties`, `LayerProperties` and `encodeFigcraft` verified. |

## Reproduction

```sh
npx vitest run tests/parity/layer-scrolling.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "overflow and a layer's scroll position" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 7c to 10.
