# Roadmap row 15, item 5: player requests and unknown parameters

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `60b9ae9`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

`proto.present` and `proto.preview` pick the frame a prototype starts at as native does (the given layer's top-level frame, else the selection's, the page's first flow, or its first frame in reading order) and ask the interface to open the presenter or the preview pane; `proto.closePreview` closes the pane; `proto.presentOptions` keeps the presenter's scale and switches for later presentations; `proto.linkNotice` keeps the link notice preference ([`prototype-commands.ts`](../../src/engine/prototype-commands.ts), [`editor.ts`](../../src/engine/editor.ts)). Every proto command now refuses parameters it does not take, listing the ones it does, as native's command registry does; items 1 to 4 had ignored them.

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-prototype-player.json](../../tests/fixtures/native-prototype-player.json) | Three sequences: player starts and refusals, options and the preference, every command's unknown-parameter refusal | Every receipt and error matches; the editor's snapshot carries the requests. Failed before |

Provenance: [player requests and unknown parameters](../../tests/fixtures/native-prototype-player.provenance.md).

## Recorded differences

- **No presenter yet.** The requests are on the editor's snapshot; the presenter and preview pane (item 10) open from them and take the browser case, in the deferred queue.
- **Preferences.** The link notice preference lives with the editor session, as the port keeps no desktop preference file.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/proto.rs::{open_player, proto.presentOptions, proto.linkNotice}`, `crates/doc/src/lib.rs::frames_in` | `prototype-commands.ts` `playerStart`, `topFrames`; `editor.ts` snapshot |
| `crates/engine/src/cmd.rs::refuse_unknown_params` | `prototype-commands.ts` `refuseUnknown` |

[Property matrix](26-11-24-prototype-player-requests-parity.html) · [Plan](../planning/26-11-24-prototype-player-requests.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-player.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `60b9ae9`, native reference `bad07e44` |
| Failing fixtures first | The parity case failed before |
| Full pure suite | 5,598 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 17.2-minute run at `60b9ae9` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed in 18.85 seconds, run once after the browser gates of items 5 to 7a (runs are spaced an hour apart to stay within the local publication rate limit) |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,114 nodes/38,811 edges at `60b9ae9`; native 28,939/92,127 at `bad07e44`; combined 38,053/129,733. `playerStart`, `topFrames`, `refuseUnknown`, `presentScales` and `executePrototype` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-player.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 6 to 10.
