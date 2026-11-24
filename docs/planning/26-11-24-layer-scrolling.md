# Roadmap row 15, item 7b: a layer's overflow and scroll position

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `e28d7c0`: [report](../reports/26-11-24-layer-scrolling.md), [matrix](../reports/26-11-24-layer-scrolling-parity.html), [provenance](../../tests/fixtures/native-layer-scrolling.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `a9be97c` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/document.ts` (`overflow`, `scrollPosition` on layers); `src/engine/properties.ts` (`node.set` props); `src/engine/file-format.ts` (read and written as `overflow` and `scroll_position`); tests `tests/parity/layer-scrolling.test.ts` and one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-layer-scrolling.json` with provenance.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract

- **`doc/src/node.rs`**: every layer has `overflow` (none, horizontal, vertical, both) and `scroll_position` (scrolls, fixed, sticky), written only when not the default.
- **`node.set`**: `overflow` and `scrollPosition` by name in any case; another value is refused with the names (`overflow: none|horizontal|vertical|both`, `scrollPosition: scrolls|fixed|sticky`); setting the default removes them. `node.get` does not report them.

## What the port had

The model had neither field, `node.set` refused them as unsupported, and opening a file that set either failed.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/node.rs::{Overflow, ScrollPosition}` | `document.ts` `LayerProperties.overflow`, `scrollPosition`; `file-format.ts` `scrolling` | Native observation with saves; browser open and save |
| `engine/src/cmd/props.rs` (`overflow`, `scrollPosition` props) | `properties.ts` | Native observation |

## Acceptance

- The native sequence matches (sets, refusals, saves, reopening); a browser case opens a native file with both and saves them back. Both failed before.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
