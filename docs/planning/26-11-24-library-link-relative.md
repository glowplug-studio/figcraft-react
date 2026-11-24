# Delta row 6, item 1: library link relative paths

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `a89c897`: [report](../reports/26-11-24-library-link-relative.md), [matrix](../reports/26-11-24-library-link-relative-parity.html), [provenance](../../tests/fixtures/native-library-link-relative.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `a6ec094` on `prompt/full-figcraft-port`.
- Upstream commit: `7b34dbab` (#2132). Ledger item 6.1.
- Files changed: `src/engine/published-library.ts` (`LibraryLink.relative`, `readLibraryLinks`, `wireLibraryLinks`); tests `tests/parity/library-link-relative.test.ts` (new), one case in `tests/e2e/preview.spec.ts`; fixture `tests/fixtures/native-library-link-relative.json` with provenance.
- Next action: none; the item is recorded and row 6 is closed.
- Blockers: none.

## Native contract

- **`doc/src/library.rs`**: a library link carries `relative`, the library file's place from the folder of the document that links it, '/'-separated, omitted when empty.
- **`engine/src/assets/library.rs::relate_links`, `cmd/file/save.rs`**: saving to a path writes it (none for server links). **`resolve_links`, `cmd/file/load.rs`**: opening from a path follows it first when the file is there, takes a relative `path` from the document's folder, then clears it. A document with no path does neither, so `relative` passes through unchanged.

## What the port had

The port read library links' id, name, path and version and dropped `relative`, so a file saved by the port lost it.

## The browser port

The port has no document paths (files are opened from and saved to the browser), which is native's path-less case: it now carries `relative` through open and save unchanged. Writing it from a path and following it on open need a file system, which the browser does not give.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/library.rs` `LibraryLink::relative` | `published-library.ts` `LibraryLink.relative` | Native open and save as data |
| `engine/src/assets/library.rs::{relate_links, resolve_links}` | None: no document path in the browser | Recorded |

## Acceptance

- The native observation matches; the test failed before. Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
