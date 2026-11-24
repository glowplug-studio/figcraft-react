# Roadmap row 15, item 1: interaction and flow commands

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `dc432fb`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

The port read and wrote prototype data in every format but had no command that edits it. It now has native's seven interaction and flow commands ([`prototype-commands.ts`](../../src/engine/prototype-commands.ts)): `proto.interaction.add`, `set`, `remove` and `clear`, and `proto.flow.add`, `rename` and `remove`. They take the values a file holds, with native's camelCase spellings, and apply native's defaults and limits: durations clamped to a minute, delays only on mouse enter, leave, down and up (capped at ten minutes), a manual overlay's offset clamped and dropped from other positions, every destination checked, flows only at top-level frames of the current page. Errors read as native's. An overlay background is now also read from CSS text or channels, as native's colour reader takes it ([`prototype-data.ts`](../../src/engine/prototype-data.ts)).

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-prototype-interactions.json](../../tests/fixtures/native-prototype-interactions.json) | Three command sequences (interactions, flows, limits) with receipts, errors and the stored interactions and flows at each save | Every receipt, error and stored value matches. Failed before (no such commands) |

Provenance: [prototype interaction and flow commands](../../tests/fixtures/native-prototype-interactions.provenance.md).

## Recorded differences

- **Expressions.** Expression text (`count + 1`) and variables, collections and modes named by name are read by item 2; until then such text is refused and names are kept as given.
- **No browser case.** Nothing in the interface reaches these commands yet; the prototype tab (item 8) takes the browser case.

## Native mapping

| Native | React |
|---|---|
| `crates/engine/src/cmd/proto.rs::{add, set, settle, duration, delay, check_dests}` | `prototype-commands.ts` `executePrototype` |
| `crates/engine/src/cmd/proto.rs` `proto.interaction.{clear,remove}`, `proto.flow.*` | `prototype-commands.ts` `executePrototype` |
| `crates/engine/src/automation/params.rs::req_targets` | `prototype-commands.ts` targets |
| `crates/doc/src/lib.rs::top_level_frame` | `prototype-commands.ts` `topLevelFrame` |
| `crates/color/src/lib.rs` `ColorRepr` | `prototype-data.ts` `overlayBackground` |

[Property matrix](26-11-24-prototype-interactions-parity.html) · [Plan](../planning/26-11-24-prototype-interactions.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-interactions.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `dc432fb`, native reference `bad07e44` |
| Failing fixtures first | The parity cases failed before |
| Full pure suite | 5,591 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 17.9-minute run at `dc432fb` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed, run once after the browser gate (a second run inside the hour then met the local publication rate limit, as repeated runs do) |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 8,971 nodes/38,313 edges at `dc432fb`; native 28,939/92,127 at `bad07e44`; combined 37,910/129,238. `executePrototype`, `prototypeSpecs`, `topLevelFrame`, `readPrototype` and `overlayBackground` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-interactions.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 2 to 10: expressions, action and conditional commands, prototype settings, player requests, the player's state machine, the prototype tab, canvas connections and the presenter.
