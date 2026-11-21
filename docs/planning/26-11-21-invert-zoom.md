# Delta row 2, item 15: the Invert zoom direction preference

## Execution checkpoint

- Phase: complete through Phase 7 on 21 November 2026 at `7648788`: [report](../reports/26-11-21-invert-zoom.md), [matrix](../reports/26-11-21-invert-zoom-parity.html), [provenance](../../tests/fixtures/native-invert-zoom.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `8a59a66` on `prompt/full-figcraft-port`.
- Upstream commits: `6fce958a` (#2145), `1ef0c16f` (#2147 review). Ledger item 2.11.
- Files landed: `src/engine/editor.ts`, `viewport.ts`, `canvas.ts`, `src/InvertZoomPreference.tsx` (new), `src/Editor.tsx`; tests `tests/parity/invert-zoom.test.ts` (new), `tests/e2e/preview.spec.ts`; fixture `native-invert-zoom.json` and its provenance.
- Next action: none for this item.
- Blockers: none.

## Native contract

- A preference, `invert_zoom` (`crates/engine/src/prefs.rs`), off by default, with the command `pref.invertZoom {on?}`: `on` sets it, anything that is not a boolean toggles it, an unknown parameter is refused, and the result is `{on}`.
- A checkbox, Invert zoom direction, in the Preferences window after Scroll wheel zoom.
- With it on, Cmd or Ctrl with the wheel, and a plain mouse wheel when Scroll wheel zoom is on, zoom the other way by the same factor: the factor's reciprocal (`ui-egui/src/canvas/input.rs::invert_zoom_factor`). A trackpad pinch and panning are unchanged. The zoom commands are unchanged.
- The preference is saved with the others, off as well as on.

## What the port had

Two preferences only, the display name and the server for online sharing. Ctrl or Cmd with the wheel zoomed; there was no way to reverse it.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `prefs.rs` `invert_zoom`, `cmd/view.rs` `pref.invertZoom` | `editor.ts` `invertZoom`, the `pref.invertZoom` case | Two native sequences in `native-invert-zoom.json` |
| `ui-egui/src/canvas/input.rs` wheel handling, `invert_zoom_factor` | `viewport.ts::wheelView`, called by `canvas.ts` | Wheel tests restating `wheel_zoom_tests.rs`; signed-in browser workflow |
| `ui-egui/src/dialogs.rs` checkbox; saved preferences | `InvertZoomPreference.tsx` in the Preferences section, saved in the browser | The browser workflow, across a reload |

## Hazards and known differences

- **Telling a pinch from Ctrl+wheel.** A browser reports a trackpad pinch as a wheel event with `ctrlKey` set. The canvas now tracks whether a Control key is down: `ctrlKey` with no Control key is a pinch and is left alone. Cmd is always a key.
- **No Scroll wheel zoom preference.** Native's other wheel preference is not in the port; a plain wheel always scrolls. The general Preferences window is part of the interface row.
- **Where it is saved.** Native saves preferences in its settings file. The port saves this one in the browser's local storage, like the display name, and keeps it for the session when storage is unavailable.

## Acceptance

- Both native sequences match.
- Wheel tests restating the native interface tests pass: Cmd and Ctrl with the wheel are reversed by the same factor; a pinch and scrolling are unchanged.
- A signed-in browser workflow shows Ctrl+wheel reversed, a pinch unchanged and the preference kept across a reload.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations, zero fixture counts.
- Records: report, property matrix, provenance, cross-repository mapping, the row 2 plan and the ledger.
