# Native observations for prototype settings

Data: [native-prototype-settings.json](native-prototype-settings.json).

- Native revision: `bad07e4433240cad046589129c084bd2fc36f097`.
- Observed on 24 November 2026 by the prebuilt disposable `replay` executable of the [ellipse provenance](native-ellipse-four-anchor.provenance.md), in the `rust:latest` Docker image with the pinned source mounted read-only. The port copied the observed output; it did not generate these expectations with its TypeScript.

## What the file holds

One sequence of `proto.settings` calls on a new document, each with native's answer or error, and the page's saved `prototype` at two saves.

| Steps | What they cover |
|---|---|
| Devices | Reading the defaults; a device in any case and with spaces; an unknown device and a number refused with the list |
| Colours | A device's colour in any case; a colour dropped when another device lacks it; refusals listing the colours, a custom size's lack of them, a non-text colour; clearing |
| Rotation | `landscape`, 90, 0; a device that does not turn keeps the setting without turning; a bad rotation refused |
| Custom size | A width picks Custom size; a height capped at 10,000; zero, text and a text height refused |
| Responsive and background | A boolean only; a background with alpha answered as `#RRGGBB` and saved whole |
