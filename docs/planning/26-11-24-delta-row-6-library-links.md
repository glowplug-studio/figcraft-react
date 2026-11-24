# Upstream delta row 6: library links

## Execution checkpoint

- Phase: Phase 1 on 24 November 2026: the row's one commit is read; item 1 is next.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React revision: the row 5 records commit on `prompt/full-figcraft-port`.
- Source queue: row 6 of the [upstream delta queue](26-11-15-upstream-delta.md), range `7bf098d7..bad07e44`, with its commit taken from the [commit ledger](26-11-20-upstream-delta-ledger.md).
- Files in progress: none.
- Native oracle: `$HOME/.cache/figcraft-oracle/project`; `replay` opens and saves files as base64 without a file path, which is the browser port's situation.
- Next action: open item 1, library links that keep working when the project folder moves (ledger 6.1, upstream `7b34dbab`, #2132). Natively a library link carries `relative`, the library file's place from the document's folder: written on save from a document's path, followed first on open when the file is there, then cleared; server links keep none. A document with no path (opened or saved as data) leaves `relative` as it was. The port has no document paths, so it must carry the field through open and save unchanged (`crates/doc/src/library.rs`, `crates/engine/src/assets/library.rs::{relate_links, resolve_links}`, `cmd/file/save.rs`; port `published-library.ts::{LibraryLink, readLibraryLinks}`, `file-format.ts` library wiring). Native observed; port, gate and record.
- Blockers: none.

| Item | Ledger | Upstream behaviour | Native files and tests | React files | Status |
|---|---|---|---|---|---|
| 1 | 6.1 | Library links keep working when the project folder is moved or cloned (#2132; `7b34dbab`) | `doc/src/library.rs`, `engine/src/assets/library.rs`, `engine/src/cmd/file/{load, save}.rs`; `engine/src/assets/library/tests.rs` | `published-library.ts`, `file-format.ts` | Next; native observed |

## Acceptance

Native observations recorded with provenance; each new case fails without its change; the full pure suite, strict types, both builds, the cumulative browser gate, provider integrations once, zero fixture counts and the local graph pass before the item is recorded.
