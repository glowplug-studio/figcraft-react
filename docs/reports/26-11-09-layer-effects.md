# Layer effects

Figcraft React 0.48.0 renders all seven native effect types on supported layers. The Design inspector edits ordered stacks, numeric properties, colours and progressive blur handles. Authenticated native open, device recovery and download retain the effect records. [Property matrix](26-11-09-layer-effects-parity.html).

Source checkpoints on prompt/full-figcraft-port include native records d54f4a5, shadows 726d526, layer blur 1c48d9b, background blur 1056d9f, grain ba9ee11, glass 20ae98c, settings 8cdfd22 and the release implementation f278b1b. The slice targets Rust 8a7ebc24. The global baseline remains 8eb0b876. [Cross-repository mapping](../parity/cross-repository-mapping.md).

At f278b1b all 204 production Chromium workflows passed in 379.9 seconds on the first attempt, with one worker. Strict types, both production builds, 1,153 pure tests and two real local Auth tests passed. The scoped Figcraft Supabase read returned zero public tables. Effect data lives in the native document and uses the existing host access boundary.

The 10,000-node fixture measured 1.90 ms input and 4.90 ms total frame time at p95 over 110 frames, with zero root publications. After collection, JavaScript heap changed by 32,524 bytes and backing-store memory by 0 bytes. The scene includes one visible 76 × 48 glass layer. Larger effects, whole-host peak memory and long sessions have distinct costs and retain their own final audit. [Measurements](26-11-09-layer-effects-measurements.json).

Canvas 2D supplies antialiasing and browser colour swatches. Stable shape-relative raster tiles eliminated the observed 34-channel discrepancy in a cropped, oversized smoothed pane. The retained pixels of all nine test bands now match the full view. [Fixed visual reference](../../tests/e2e/effect-regression.spec.ts-snapshots/seven-native-effects.png).

Effect style links, numeric and colour variables, Dev Mode inspection, exported graphics and shared-file operations are tracked against their owning roadmap slices. The release is local. This slice requires no human action.
