# Gradient paints

React 0.43.0 at 113507a7338007970f557bc81de418db8f5e4bd3, upstream 8a7ebc2484a6d64d80a13c19c18ffb814325e347, global supported baseline 8eb0b876. Strict TypeScript, library and Next.js production builds, 989 pure tests, two real local Auth tests and 137 Chromium workflows passed. One worker, zero retries, skips, failures or flaky results. Browser suite duration 301.4 seconds.

Fill, stroke and regional paint stacks support linear, radial, angular and diamond gradients. The browser uses Canvas 2D gradients and the native diamond texel sampling rule. An anchored browser picker, captured pointer input and keyboard stop deletion support editing. Tests cover native archives, undo, independently transformed vector regions, narrow layouts, device recovery and authenticated server rendering. The skewed diamond seam fixture samples all 10,000 pixels. [Property matrix](26-11-09-gradient-paints-parity.html).

The benchmark displayed 100 gradients in a 10,000-node document. Of 120 diamond handle previews, 110 were measured after warm-up. Input p95 was 0.2 ms, combined JavaScript input and paint submission p95 3.1 ms and maximum 6.8 ms. Root notifications during the drag were 0. One undo restored the original document. [Raw pixels and timings](26-11-09-gradient-paints-measurements.json).

The scoped Figcraft Supabase read returned zero public tables. Gradients use the existing provider-neutral host identity and local document persistence. Linked variables, text range editing, external export, wider host memory and sustained runtime remain assigned to their roadmap stages. Branch `prompt/full-figcraft-port`. The next dependency is image resources and image paints.
