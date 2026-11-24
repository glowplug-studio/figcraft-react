# Native observations for library links' relative paths (upstream 7b34dbab, #2132)

Data: [native-library-link-relative.json](native-library-link-relative.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

A document linking two libraries: a file library (`/projects/old/brand.figcraft`, relative `brand.figcraft`) and a server library (`wss://example.invalid/library`, relative `stale.figcraft`). Native opened it with `file.open` from data (no file path), listed its libraries, and saved it with `file.saveAs` as data (no path).

| Step | Native result |
|---|---|
| `library.list` | Both links, with their paths, seen versions and whether each is a server link |
| `file.saveAs` | Both links written back with `relative` unchanged: with no document path, native neither resolves the links on open (`resolve_links`) nor recomputes `relative` on save (`relate_links`) |

Native's own tests (`assets/library/tests.rs`) cover saving to a path, moving the folder and server links, which need a file path the browser port does not have.
