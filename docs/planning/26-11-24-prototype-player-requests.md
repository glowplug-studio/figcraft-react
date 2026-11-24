# Roadmap row 15, item 5: player requests and unknown parameters

## Execution checkpoint

- Phase: implemented; the gate is running.
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `7cd0082` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-commands.ts` (`proto.present`, `proto.preview`, `proto.closePreview`, `proto.presentOptions`, `proto.linkNotice`, `topFrames`, the unknown-parameter refusal for every proto command); `src/engine/editor.ts` (snapshot fields `prototypePlayer`, `presentOptions`, `linkNoticeSkipped`); test `tests/parity/prototype-player.test.ts`; fixture `tests/fixtures/native-prototype-player.json` with provenance.
- Next action: record the item.
- Blockers: none.

## Native contract

- **`cmd/proto.rs::open_player`**: `proto.present` and `proto.preview` start at `start`'s top-level frame (a layer inside a frame presents its frame; anything else is refused), else the selected layer's top-level frame, the page's first flow, or its first top-level frame in reading order (rows top to bottom, then left to right, sections included); with none, "no frame to present". They ask the interface to open the presenter or the preview pane and answer `{start}`. `proto.closePreview` closes the preview pane.
- **`proto.presentOptions`**: `scale` (fit, fitWidth, fill, actual) and the booleans `deviceFrame`, `hotspotHints`, `inspect`, `hideUi`, at least one; kept for later presentations. **`proto.linkNotice`**: `show` (lenient boolean, default true) sets the preference and answers `{shown}`.
- **`cmd.rs::refuse_unknown_params`**: every command refuses parameters its documentation does not name (`id` and `ids` are always taken), listing the ones it takes. Items 1 to 4 lacked this; it now covers all 21 proto commands.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/proto.rs::{open_player, proto.presentOptions, proto.linkNotice}`; `doc/src/lib.rs::frames_in` | `prototype-commands.ts` `playerStart`, `topFrames`; editor snapshot | Native observations |
| `cmd.rs::refuse_unknown_params` | `prototype-commands.ts` `refuseUnknown` | Native observations of all 21 lists |

## Acceptance

- Three native sequences match: player starts and refusals, options and the preference, and every command's unknown-parameter refusal. A unit case checks the editor's snapshot. The tests failed before.
- No browser case: the presenter (item 9) opens from these requests and takes it, in the deferred queue.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
