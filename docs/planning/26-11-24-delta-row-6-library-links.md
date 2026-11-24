# Upstream delta row 6: library links

## Execution checkpoint

- Phase: items 1 to 1 complete through Phase 7 at `a89c897` ([library link relative paths](../reports/26-11-24-library-link-relative.md)). Row closed on 24 November 2026.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React revision: the row 5 records commit on `prompt/full-figcraft-port`.
- Source queue: row 6 of the [upstream delta queue](26-11-15-upstream-delta.md), range `7bf098d7..bad07e44`, with its commit taken from the [commit ledger](26-11-20-upstream-delta-ledger.md).
- Files in progress: none.
- Native oracle: `$HOME/.cache/figcraft-oracle/project`; `replay` opens and saves files as base64 without a file path, which is the browser port's situation.
- Next action: none; the row is closed.
- Blockers: none.

| Item | Ledger | Upstream behaviour | Native files and tests | React files | Status |
|---|---|---|---|---|---|
| 1 | 6.1 | Library links keep working when the project folder is moved or cloned (#2132; `7b34dbab`) | `doc/src/library.rs`, `engine/src/assets/library.rs`, `engine/src/cmd/file/{load, save}.rs`; `engine/src/assets/library/tests.rs` | `published-library.ts`, `file-format.ts` | Verified at `a89c897` with native observations ([plan](26-11-24-library-link-relative.md)) |

## Acceptance

Native observations recorded with provenance; each new case fails without its change; the full pure suite, strict types, both builds, the cumulative browser gate, provider integrations once, zero fixture counts and the local graph pass before the item is recorded.
