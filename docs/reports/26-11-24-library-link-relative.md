# Upstream delta row 6, item 1: library link relative paths

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `a89c897`. **This bounded item passes and closes row 6. Rows 7 and 8, the roadmap and the full port remain unfinished.**

## Implemented boundary

Native library links gained `relative`, where the library file is from the folder of the document that links it, so a link survives moving or cloning the folder. Native writes it on saving to a path and follows it on opening from one; a document with no path passes it through unchanged. The browser port always works without a document path, so it now reads `relative` and writes it back as it was ([`published-library.ts`](../../src/engine/published-library.ts)). Before, it dropped the field, and a file saved by the port lost its links' relative places.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-library-link-relative.json](../../tests/fixtures/native-library-link-relative.json) | A document with a file library and a server library, each carrying `relative`, opened and saved as data | The listed links and the saved links match, `relative` kept on both. Failed before |
| Browser: the same document opened and saved in the editor | Both links keep `relative`; the file library's saved link equals native's |

Provenance: [library link relative paths](../../tests/fixtures/native-library-link-relative.provenance.md).

## Recorded differences

- **No document path.** Writing `relative` from a document's path and following it on open need a file system the browser does not give; the port keeps the field as native does for a path-less document.
- **Server links.** The port holds a server library's invite address under a hashed team-library key and never writes the address back, an earlier choice that keeps share secrets out of the document model; the case compares server links by everything else.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/library.rs` `LibraryLink::relative` | `published-library.ts` `LibraryLink.relative`, `readLibraryLinks`, `wireLibraryLinks` |
| `crates/engine/src/assets/library.rs::{relate_links, resolve_links}` | None (no document path in the browser) |

[Property matrix](26-11-24-library-link-relative-parity.html) · [Plan](../planning/26-11-24-library-link-relative.md) · [Parity](../../tests/parity/library-link-relative.test.ts) · [Browser](../../tests/e2e/preview.spec.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `a89c897`, native reference `bad07e44` |
| Failing fixtures first | The parity case failed before |
| Full pure suite | 5,587 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 18.2-minute run at `a89c897` with zero skips, retries, flakes or suite errors: the 429 earlier cases and the new ones. No baseline changed |
| Real local provider integrations | 32 passed in 15.00 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,939 nodes/38,208 edges at `a89c897`; native 28,939/92,127 at `bad07e44`; combined 37,878/129,138. `readLibraryLinks`, `wireLibraryLinks`, `LibraryLink`, `relate_links` and `resolve_links` verified. |

## Reproduction

```sh
npx vitest run tests/parity/library-link-relative.test.ts
FIGCRAFT_LOCAL_TEST_PORT=3101 npx playwright test tests/e2e/preview.spec.ts -g "keeps its relative path" --workers=1 --retries=0
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 6 is closed. Row 7 was verified earlier; row 8's items wait for unported roadmap rows (boards, Dev Mode).
