# Painted vector region selection

React 0.34.0 revision 59700e8486724e843cd1f5fdaa9fd1f7c3019f24, upstream 8a7ebc2484a6d64d80a13c19c18ffb814325e347. All 908 pure tests, two local Auth integration tests and 113 Chromium workflows passed. Full Chromium run 237.3 seconds, one worker, zero skips or retries. Strict TypeScript, package and Next.js production builds passed.

The Move tool picks a painted region, shows a clipped hatch and moves its points. Shift toggles regions while preserving shared and independently selected points. The canvas uses screen-space strokes. Selection is transient and the saved file retains the authored network.

Across 10,000 nodes, 100 visible edited vectors and 103 selected points, p95 input was 3.6 ms, drag and draw 5.7 ms, hover and pan 3.6 ms. No root or inspector notifications. Cancel restored the captured document and selection. [Raw measurements](26-11-09-vector-region-selection-measurements.json). [Twelve property checks and manual actions](26-11-09-vector-region-selection-parity.html).

The first pure run exposed two previous fixtures that treated painted interiors as empty canvas. Their original assertions now use empty space. The initial desktop and performance checks passed. A provisional full run passed 111 of 113 checks. The narrow viewport used an incorrect button locator. Actual point counts also exposed a pre-existing scale benchmark that picked a vertex in another layer. The corrected test uses the production “Fit selection” control. The benchmark spaces the edited rows apart and asserts the far layer actually scales. Both focused checks passed before the full rerun. The locally scoped Supabase check returned zero public tables. Auth integration uses the existing provider adapter. This slice introduces no database, grants or Realtime change.

Geometry d200487, pointer integration 4ac23e9 and benchmark fixture 59700e8 on prompt/full-figcraft-port. The global baseline remains 8eb0b876. Remaining work includes region Fill inspector commands, non-solid paint kinds, boolean operations and the other master roadmap families. Publication awaits the complete product audit. No user action is required.
