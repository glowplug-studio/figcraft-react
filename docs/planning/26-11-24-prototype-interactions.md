# Roadmap row 15, item 1: interaction and flow commands

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `dc432fb`: [report](../reports/26-11-24-prototype-interactions.md), [matrix](../reports/26-11-24-prototype-interactions-parity.html), [provenance](../../tests/fixtures/native-prototype-interactions.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `d2ce2b7` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-commands.ts` (new: `prototypeSpecs`, `executePrototype`, `topLevelFrame`); `src/engine/prototype-data.ts` (`readPrototype`, an overlay background as CSS text or channels); `src/engine/editor.ts` (dispatch); test `tests/parity/prototype-interactions.test.ts`; fixture `tests/fixtures/native-prototype-interactions.json` with provenance.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract

- **`proto.interaction.add`**: `{id, dest}` without `action` adds a click-navigate; otherwise `actions` (when not empty) or `action` is required. Trigger, transition and easing default to on click, instant and ease out; the duration to 300 ms, clamped to 0–60,000 and truncated. A delay is kept only on mouse enter, leave, down and up, capped at 600,000 ms and rounded; a negative or non-numeric delay is refused. An overlay's offset is kept only on a manual position, clamped to ±100,000. Every destination must exist. The interaction goes on every target (`ids`, else `id`, else the selection); the answer is the last one's index.
- **`proto.interaction.set`**: patches the interaction at `index` (or replaces it with `interaction`), `action` replacing the first action. A target without that index is skipped; none having it is refused, and so is an interaction left without actions.
- **`proto.interaction.remove`**: `index` must be a whole number in 0..1e9; a target without it is skipped, none having it is refused. **`clear`** empties every target's list.
- **`proto.flow.add`**: starts at `start` or the first selected layer, which must be a top-level frame; a frame that already starts a flow answers that flow. A blank name gets the first unused "Flow N". **`rename`** trims the name and refuses a blank one or a frame without a flow; **`remove`** drops the flow starting there.
- Errors read as native's: `invalid parameters for \`cmd\`: …`, a parameter that does not parse names the parameter, an unknown action, trigger or transition lists the variants.

## The port

`prototype-commands.ts` implements the seven commands over the existing document model and reuses its readers, so a command takes the same values a file holds (with native's `durationMs`, `delayMs`, `preserveScroll`, `closeOnOutside` and `openInNewTab` spellings). The overlay background now also takes CSS text and channel arrays, as native's colour reader does, in files too. Expression text arrives with item 2; until then an action with `expression` text is refused as a parameter that does not parse.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `cmd/proto.rs::{add, set}`, `settle`, `duration`, `delay`, `check_dests` | `prototype-commands.ts` | Native observations (three sequences) |
| `cmd/proto.rs` `proto.interaction.{clear,remove}`, `proto.flow.*` | `prototype-commands.ts` | Native observations |
| `automation/params.rs::req_targets` | `prototype-commands.ts::targets` | Native observations of its errors |
| `doc/src/lib.rs::top_level_frame` | `prototype-commands.ts::topLevelFrame` | Native observations |
| `color/src/lib.rs` `ColorRepr` for an overlay background | `prototype-data.ts::overlayBackground` | Native observation (`#00000040`) |

## Acceptance

- The three native sequences match command by command, with the stored interactions and flows after each save; undo restores a removal. The test failed before (no such commands).
- No browser case: nothing in the interface reaches these commands yet. The prototype tab (item 8) takes it.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
