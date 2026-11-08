# Closed vector corner smoothing

React 0.32.0 at ca85638ec78841a5d9943063188fb48742189d2f on prompt/full-figcraft-port. Native reference 3daa9d3293c5973bc8811e9b1108cea3224690aa. All 888 pure tests, two local Supabase Auth checks, strict TypeScript, the library build and the Next.js production build passed. The full Chromium run took 230.9s. All 109 checks passed without retries or skips. The smoothing implementation is 43ddc4b.

Closed vectors share the polygon corner profile while preserving per-point radii. Region paints, stroke paths, brush and variable-width input geometry, masks and hit tests use the drawn network. Native saves retain the authored network and smoothing value. Open paths, curved neighbours and sharp junctions preserve their native rounding behaviour.

The first full run exposed an obsolete expectation after restoring a flattened two-region vector. The corrected fixture checks that the user can access smoothing after reload. Both affected browser tests passed independently, followed by the complete suite.

Nine paired fixtures cover shape area, asymmetric radii, 32 loop/segment direction combinations, holes, concave shapes, malformed loops and hit discrimination. Authenticated Chromium verified pixels, pointer selection, eligibility, undo/redo, local recovery and the mobile preset. [Property matrix](26-11-07-closed-vector-smoothing-parity.html) · [Fixed screenshot](../../tests/e2e/preview.spec.ts-snapshots/closed-vector-smoothed-corner.png) · [Measurements](26-11-07-closed-vector-smoothing-measurements.json)

On 10,000 nodes with 100 visible vectors, including 33 smoothed rings, resize measured 9.20 ms, drawing 8.00 ms and pan 12.20 ms p95. Full-app memory and long-session verification remain future gates. Hosted Supabase listing succeeded with no public tables. The local React graph contained 1,800 nodes. The hosted React index at the original slice checkpoint contained four README nodes. The [slice plan](../planning/26-11-07-closed-vector-smoothing.md) maps downstream export and shape-builder dependencies. Those features still need their own verification. Global supported baseline remains 8eb0b876.
