# Roadmap row 15, item 4: prototype settings

24 November 2026 · Branch `prompt/full-figcraft-port`. Native reference `bad07e4433240cad046589129c084bd2fc36f097`. Implementation `7ba48f9`. **This bounded item passes. The rest of row 15, the roadmap and the full port remain unfinished.**

## Implemented boundary

A page's prototype settings choose the device a prototype is presented on: one of native's 19 models (phones, a tablet, a laptop and a desktop, each with its colours), a custom size or none, its rotation, and whether frames respond to the screen. The port kept only the background and refused a file that set the rest. [`prototype-settings.ts`](../../src/engine/prototype-settings.ts) restates native's devices and rules; the page now keeps every setting through open and save ([`file-format.ts`](../../src/engine/file-format.ts)); and `proto.settings` checks, applies and answers them as native does ([`prototype-commands.ts`](../../src/engine/prototype-commands.ts)).

## Native observations

| Fixture | Content | Result |
|---|---|---|
| [native-prototype-settings.json](../../tests/fixtures/native-prototype-settings.json) | 30 `proto.settings` calls and two saves | Every answer, refusal and saved `prototype` matches; both saves open again unchanged. Failed before |

Provenance: [prototype settings](../../tests/fixtures/native-prototype-settings.provenance.md).

## Recorded differences

- **No browser case.** The prototype tab's device picker (item 8) takes it, in the deferred queue.
- **Device artwork.** The presenter draws devices in item 10.

## Native mapping

| Native | React |
|---|---|
| `crates/doc/src/proto.rs::{PrototypeSettings, Device, DeviceColor, DeviceRotation}` | `prototype-settings.ts`, `document.ts` `PageNode.prototypeDevice`, `file-format.ts` |
| `crates/engine/src/cmd/proto.rs::{settings, settings_json, known_device, rotation_of}` | `prototype-commands.ts` |

[Property matrix](26-11-24-prototype-settings-parity.html) · [Plan](../planning/26-11-24-prototype-settings.md) · [Row plan](../planning/26-11-24-roadmap-row-15-prototyping.md) · [Parity](../../tests/parity/prototype-settings.test.ts).

## Final verification

| Gate | Result |
|---|---|
| Implementation | `7ba48f9`, native reference `bad07e44` |
| Failing fixtures first | The parity case failed before |
| Full pure suite | 5,594 passed with two workers |
| Strict types / production builds | Passed |
| Cumulative Chromium | All 430 cumulative Chromium cases passed in one 16.9-minute run at `7ba48f9` with zero skips, retries, flakes or suite errors; this item adds no browser case. No baseline changed |
| Real local provider integrations | 32 passed in 14.17 seconds, run once after the browser gate |
| Fixture cleanup | All twelve counts zero |
| Schema / hosted | No change; no hosted call |
| Local graph | React 9,104 nodes/38,783 edges at `7ba48f9`; native 28,939/92,127 at `bad07e44`; combined 38,043/129,705. `prototypeSettings`, `presentedDevice`, `knownDevice`, `wirePrototype` and `samePrototypeDevice` verified. |

## Reproduction

```sh
npx vitest run tests/parity/prototype-settings.test.ts
npx vitest run --exclude 'tests/integration/**' --maxWorkers=2
npm run typecheck
npm run preview:build
```

## Remaining gaps

- Row 15 items 5 to 10.
