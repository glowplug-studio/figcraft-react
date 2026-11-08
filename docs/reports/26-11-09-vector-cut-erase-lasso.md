# Vector Cut, Eraser and Lasso

React 0.36.0 (b737b56df913fab24a7472ab965c6c53363f755b). Upstream 8a7ebc2484a6d64d80a13c19c18ffb814325e347. Global supported baseline 8eb0b876. Strict TypeScript, library and Next.js production builds, 922 pure checks, both local Supabase Auth tests and all 119 Chromium workflows passed. One browser worker, zero retries and zero skips, 256.0 seconds.

Implemented finite-line and point cuts, component extraction and refit, an interpolated circular Eraser, and multi-layer Lasso selection. The independent TypeScript geometry drives the registered commands and the pointer tools. The browser workflow verifies captured input, keyboard shortcuts, cancellation, history, native file recovery and narrow controls. Two existing screenshot baselines changed only around the expanded toolbar. All eleven scoped properties passed. [Property matrix](26-11-09-vector-cut-erase-lasso-parity.html).

Input and draw p95 in a 10,000-node scene with 100 edited layers was 2.5 ms for Lasso, 2.1 ms for Cut, 4.0 ms for Eraser. Each gesture ran for 110 measured frames after warm-up. Pointer movements issued zero root or inspector notifications. [Raw measurements](26-11-09-vector-cut-erase-lasso-measurements.json).

Scoped Supabase MCP reported zero public tables. The existing local authenticated editor and capability boundaries cover these document and selection operations. No new persistence service or migration is required. Object booleans, Shape Builder and the board eraser remain on their respective roadmaps. Local commit b737b56 on prompt/full-figcraft-port. Publication awaits the final parity audit.
