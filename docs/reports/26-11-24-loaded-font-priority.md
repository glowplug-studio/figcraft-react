# Upstream delta row 3, item 11: loaded font priority

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `9b9fbf2`. **This bounded item passes. Seven items of row 3, the other delta rows and the full port remain unfinished.**

## Implemented boundary

Upstream #2092 makes a font loaded with `text.loadFont` win over the built-in and installed faces of the same family and style, the latest load over earlier ones.

- **Load order.** [`FontLibrary.addLoaded`](../../src/engine/font-library.ts) numbers each loaded face; a family with a loaded face keeps a copy of its faces sorted latest load first, the rest in the order added, which `find` searches. [`importFontBytes`](../../src/engine/text-node-layout.ts) adds faces this way.
- **Unchanged.** Styles a load did not bring, style matching, fallbacks and the same-file cache behave as before; a browser local font added after a load does not displace it.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-loaded-font-priority.json](../../tests/fixtures/native-loaded-font-priority.json) | Two scenes: Inter Bold, then SemiBold, then Bold again, each named Inter Regular, over a text in Inter; and two Proof Regular files | Every receipt matches: widths 111, 110 and 110, the refitted lists, and Proof drawing in the later bold file. Both scenes failed before; so did the library case restating native's unit test |

Provenance: [loaded font priority](../../tests/fixtures/native-loaded-font-priority.provenance.md).

## Recorded differences

- **Built-in faces.** The native oracle has no embedded fonts, so its `text.fonts` for Inter lists only the loaded Regular; the port also lists its bundled Italic, SemiBold and Bold. The test checks only that Regular is listed in that scene.
- **Browser case.** The browser case passed after the change; the failing-first evidence is the pure cases, which share the engine.

## Native mapping

| Native | React |
|---|---|
| `crates/text/src/fontdb.rs::{add_loaded, Face::loaded}` | `font-library.ts::FontLibrary.addLoaded` |
| `crates/text/src/fontdb.rs::best` | `font-library.ts::FontLibrary.find` |
| `crates/text/src/fontdb.rs::load_font_bytes` | `text-node-layout.ts::importFontBytes` |

[Property matrix](26-11-24-loaded-font-priority-parity.html) · [Plan](../planning/26-11-24-loaded-font-priority.md) · [Parity](../../tests/parity/loaded-font-priority.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `9b9fbf2`, native reference `bad07e44` |
| Failing fixtures first | All three new pure cases failed before the change |
| Full pure suite | 5,516 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 415 cumulative Chromium cases passed in one 17.0-minute run at `9b9fbf2` with zero skips, retries, flakes or suite errors: the 414 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 13.99 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,853 nodes/37,753 edges at `9b9fbf2`; native 28,939/92,127 at `bad07e44`; combined 37,792/128,697. `addLoaded`, `FontLibrary`, `importFontBytes`, `add_loaded` and `best` verified. |

## Reproduction

```sh
npx vitest run tests/parity/loaded-font-priority.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "latest load first" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Installed versus built-in order is unchanged upstream as well; the browser has no installed-font scan.
- Row 3 continues with item 12.
