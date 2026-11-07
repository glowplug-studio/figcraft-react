# Vector point transforms and snapping

Version 0.26.0 on `prompt/full-figcraft-port`, reviewed base `adc59d4`. Implementation is verified locally and awaiting its integration commit. Upstream reference `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`; global parity baseline remains `8eb0b87646c5aef712326d6c431ccde5408630de`. Full product parity remains incomplete. No deployment, branch push or main merge.

## Implemented workflow

Point bounds, dimensions, resize, counter-clockwise rotation and explicit page matrices preserve active-vector semantics. Fixed rotation and flips route to selected points unless an explicit layer target is present. Shared canvas boxes transform selected points across differently rotated layers, with native point/handle/edge priority, Shift proportions and 15° turns, Alt centred scaling, interior drag/click behaviour, captured previews, cancellation and one undo step.

Point and handle gestures snap to visible vectors' vertices and segment midpoints, existing layer bounds and the parent frame. Moving points and incident midpoints are excluded. Object and pixel switches also apply to existing draw/move/resize workflows. Ctrl/⌘ suppresses objects while pixel rounding remains independently controlled. Guides reflect the final axis-locked position; exact point landings draw the native cross marker.

React owns committed dimensions and view switches; Canvas owns boxes/guides. No Rust code or runtime dependency was added. Numeric widgets use labelled HTML inputs/buttons; native shared numeric scrubbing, full view-menu chrome and persisted user preferences remain explicit later requirements. Page/frame ruler guides and layout grids depend on their still-required model/tool slices; this release does not claim them.

## Verification checkpoint

- 763 pure tests pass, including 28 new paired transform/gesture/snapping fixtures. The default suite skips two real Auth tests; both pass separately against local Supabase.
- Strict package/tests/Next TypeScript and package/Next production builds pass.
- Focused authenticated browser test passes: dimensions, edge scale, rotation, one-step undo/redo, point snapping, object/pixel switches, native save, recovery and mobile field bounds. Fixed canvas and mobile screenshots inspected.
- Three focused Chromium performance tests pass: 10,000 total nodes, 100 visible edited layers, 100 selected points, 110 measured frames per operation. Move combined p95 5.7ms/max 6.3ms/input p95 3.5ms; scale 4.1/4.8/2.5ms; rotate 4.2/4.3/2.3ms. All have zero root/point-panel preview notifications and exact document/session cancellation restoration. The 16.7ms gate is unchanged.
- Full Chromium regression: 92/92 pass in203.9s, zero skipped/failed/flaky. After the final oversized-dimension fallback correction, the rebuilt host passes the authoring workflow, all three performance cases and the extended dimension/recovery workflow (including the20,000,000-unit width case). The complete763-test pure suite and strict checks also pass after that correction.

Node 24.20.0, TypeScript 7.0.2, React 19.3.1, Next 16.4.5, Playwright 1.65.0. Browser viewport 1440×900/DPR1; mobile 390×844. Main library output 612.47kB, gzip 171.21kB; neither total Next download nor RAM. Full-host memory, broad visible complexity and long-session stability remain unproven and mandatory at final audit.

## Corrections and limitations

The initial native-style target scan failed the actual browser frame gate at 86.1ms p95. Captured sorted axis indexes now preserve target-first and point-order tie semantics while avoiding scans of every layer for every moving point. A deterministic differential fixture compares 100 candidate sets against the native target-first scan. Target collection retains 20,000 points/200,000 visited nodes and 256 moving candidates; no threshold was relaxed.

Three fixture corrections preserve native behaviour: box edges now take precedence over selected segments, Shift marquee preserves existing selection order, and the rotated multi-layer fixture disables snapping exactly as upstream does. The first authenticated preview notification assertion overlapped completion of a prior recovery save; the test now waits for that save before measuring a gesture. Engine fixtures and all three browser performance fixtures independently require zero preview notifications.

Review also caught a numeric fallback distinction: only supplied resize values are clamped. An omitted or invalid width must preserve an existing 20,000,000-unit vector while its height changes. The command and paired fixture now cover this case. The final production build and extended authenticated check include both the command correction and UI submission of changed dimensions only. Its initial test attempt omitted the existing Replace document confirmation after recovery; the fixture now exercises that confirmation and passes.

The new View switches intentionally alter ten existing canvas screenshots. Pixel comparisons against the prior committed images show every changed pixel inside the same control rectangle, x416…990/y8…47; no canvas geometry changes. The authenticated 65-test suite passes with reviewed baselines. The subsequent full92-check regression passes without screenshot updates. Full-suite performance p95/max/input p95: move5.7/6.7/3.4ms, scale4.2/4.9/2.5ms, rotate4.2/4.4/2.3ms. All owned preview processes were stopped cleanly.

## Infrastructure and continuation

Scoped Supabase MCP public-table read succeeds with no application tables. This geometry scope requires no schema, RLS, Storage, Realtime or identity changes; existing host Auth and provider-neutral boundaries remain intact. Online persistence, sharing, collaboration and their database work remain master-roadmap obligations. Both authorised Graphify repositories are queryable; Rust matches the pinned source, hosted React remains four README nodes at `b3b8a1b`. Current local AST refreshed to 1,611 nodes/7,508 edges, with two SQL parser omissions and one symbol-free performance test. Current source remains authoritative.

Continue through Pen/Pencil and dependent vector region/width/join/boolean operations, the remaining appearance/text/layout families and the complete master roadmap. Final publication remains gated on full parity. No user action is required.

See the [property matrix](26-11-07-vector-point-transforms-parity.html), [active plan](../planning/26-11-07-vector-point-transforms.md) and [master checkpoint](../planning/26-11-06-complete-figcraft-port.md).
