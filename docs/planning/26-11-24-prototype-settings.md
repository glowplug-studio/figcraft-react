# Roadmap row 15, item 4: prototype settings

## Execution checkpoint

- Phase: complete through Phase 7 on 24 November 2026 at `7ba48f9`: [report](../reports/26-11-24-prototype-settings.md), [matrix](../reports/26-11-24-prototype-settings-parity.html), [provenance](../../tests/fixtures/native-prototype-settings.provenance.md).
- Native reference: `bad07e4433240cad046589129c084bd2fc36f097` (`bad07e44`). React starting revision: `10f91d4` on `prompt/full-figcraft-port`.
- Row plan: [roadmap row 15](26-11-24-roadmap-row-15-prototyping.md).
- Files changed: `src/engine/prototype-settings.ts` (new: the 19 devices, their colours, `customSide`, `parseRotation`, `deviceModel`, `presentedDevice`, `knownDevice`, `settingsJson`); `src/engine/document.ts` (`PageNode.prototypeDevice`); `src/engine/file-format.ts` (reading and writing a page's whole `prototype`); `src/engine/interchange/append-pages.ts` (carried); `src/engine/prototype-commands.ts` (`proto.settings`); test `tests/parity/prototype-settings.test.ts`; fixture `tests/fixtures/native-prototype-settings.json` with provenance.
- Next action: none; the item is recorded.
- Blockers: none.

## Native contract

- **`doc/src/proto.rs::PrototypeSettings`**: a page's device ("None", "Custom size" or one of 19 models), background, rotation (portrait or landscape; phones and tablets turn), colour (one of the model's by name; empty or one it does not come in shows its first), custom size (1–10,000 points a side, rounded; 1280 × 720 by default) and responsive. Written as `device`, `background`, `rotation`, then `color`, `custom_size` and `responsive` when not default.
- **`engine/src/cmd/proto.rs::settings`**: every parameter checked before anything changes. A device by name in any case with spaces trimmed, an unknown one refused with the list; rotation as `portrait`/`landscape` or 0/90; a width or height picks "Custom size"; responsive a boolean; a colour one of the device's (any case), empty to clear, refused with the device's colour names; another device keeps the colour only if it comes in it. The answer is the settings after the call: device, background as `#RRGGBB`, rotation, the colour shown, the screen as presented (`null` without a device), the custom size and responsive.

## What the port had

The port kept a page's prototype background and refused any file whose page set another device, colour, rotation, custom size or responsive.

## Source mapping

| Native | React | Verification |
|---|---|---|
| `doc/src/proto.rs::{PrototypeSettings, Device, DeviceColor, DeviceRotation}` | `prototype-settings.ts`, `PageNode.prototypeDevice`, `file-format.ts` `wirePrototype` | Native observations with saves |
| `engine/src/cmd/proto.rs::{settings, settings_json, known_device, rotation_of}` | `prototype-commands.ts` `prototypeSettings` | Native observations |

## Acceptance

- 30 native steps match: every answer and refusal, and the page's saved `prototype` twice; both saves open again with the same settings. The test failed before.
- No browser case: the prototype tab's device picker (item 7) takes it, in the deferred queue.
- Full pure suite, strict types, both builds, cumulative browser gate, provider integrations once, zero fixture counts.
