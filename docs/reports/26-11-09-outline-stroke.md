# Outline stroke

React 0.39.0 (70cf05219f3677b10741d17a8c8cc5e25e05e34b). Source 8a7ebc2484a6d64d80a13c19c18ffb814325e347, global supported baseline 8eb0b876. Strict TypeScript, both production builds, 950 pure checks, two local Auth checks and 126 Chromium workflows passed in 278.9 seconds. One worker, zero retries and zero skips.

The command converts supported stroked layers to filled, editable vectors and groups retained fills beneath their outlines. Existing boolean, solid paint, profile, brush and native file implementations supply geometry and persistence. Eight before/after Chromium render comparisons passed, including rounded per-side strokes, asymmetric terminal caps, one-sided widths and arrowheads. Two real host entry points passed, including device recovery. [15-property matrix](26-11-09-outline-stroke-parity.html).

Across 15 executions on 32 dashed lines, command p50/p95 were 7.2/18.0 ms. Each undo recovered the original snapshot. Retained JS heap changed by 69,764 bytes after forced collection. [Measurement data](26-11-09-outline-stroke-measurements.json).

The scoped Figcraft MCP returned zero public tables. This command uses existing local Auth and native file recovery. Additional style links, gradient or image paints, effects and text outlines require their respective roadmap implementations and coverage. Local implementation 70cf052 on prompt/full-figcraft-port. Full publication remains pending.
