# Delta row 3, item 11: loaded font priority

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `9b9fbf2`: [report](../reports/26-11-24-loaded-font-priority.md), [matrix](../reports/26-11-24-loaded-font-priority-parity.html), [provenance](../../tests/fixtures/native-loaded-font-priority.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `de8831e` on `prompt/full-figcraft-port`.
- Upstream commits: `34c44e60`, `a375ac06` (#2092). Ledger item 3.10.
- Files changed: `src/engine/font-library.ts`, `src/engine/text-node-layout.ts`; tests `tests/parity/loaded-font-priority.test.ts` (new), one case in `tests/e2e/preview.spec.ts`, `retitledFont` in `tests/support/renamedFont.ts`; one fixture with provenance.
- Next action: none; the item is recorded. Row 3 continues in its row plan.
- Blockers: none.

## Native contract

- **`fontdb.rs::add_loaded`**: a face loaded with `text.loadFont` gets the next load number; built-in, installed and browser local faces have none.
- **`fontdb.rs::best`**: a family's faces are searched latest load first, the rest in the order they were added; exact style first, then the nearest. So a loaded face wins over every other face of its family and style, the latest load over earlier ones, and a face added later without a load does not displace it. Styles a load did not bring resolve as before.
- **`load_font_bytes`**: the same file again returns its families without adding or renumbering its faces.

## What the port had

`FontLibrary.find` searched faces in the order added, so the bundled Inter Regular kept winning after an Inter Regular file was loaded, and the first of two loads of one family and style won.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `text/src/fontdb.rs::{add_loaded, Face::loaded}` | `font-library.ts::FontLibrary.addLoaded`, `#loaded` | Library case restating the native unit test |
| `text/src/fontdb.rs::best` load order | `font-library.ts::find` over `#ranked` | Two native scenes, pure and browser |
| `text/src/fontdb.rs::load_font_bytes` | `text-node-layout.ts::importFontBytes` (`addLoaded`, digest cache) | Reloading the bold file keeps the semibold width |

## Acceptance

- Each native observation matches; each new case fails without the change.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
