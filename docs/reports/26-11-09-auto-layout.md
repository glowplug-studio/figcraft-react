# Auto layout and constraints

Local package 0.50.0 on prompt/full-figcraft-port. The implementation at dbc35f4 targets upstream 3839fe4a0cb4897c1fed1fb03e0b60e191ff61cb. The global compatibility baseline remains 8eb0b876. [Property matrix](26-11-09-auto-layout-parity.html) · [Implementation and native comparisons](../planning/26-11-09-auto-layout.md).

Horizontal, vertical, wrapping and grid layout now share sizing, bounds and constraint propagation across native document loading, editing, canvas previews, undo and recovery. The inspector supports relative edits across mixed selections and commits a focused field on Save. Browser Pointer Events implement dragging and cancellation. Local file recovery and browser downloads use the existing document adapter. The scoped Figcraft Supabase project read returned zero public tables. Local Auth passed both integration checks. Layout uses no new schema or Realtime resources.

Strict TypeScript, library and production Next.js builds and all 1,823 pure tests passed. All 250 Chromium tests passed in 515.8 seconds with zero skips or flaky results. The browser suite includes signed-in editing, save, grid paint and hit order, smart reordering, cancellation and native downloads. All 65 native layout rules matched on two successive reflows. Mixed geometry matched 1,440 native snapshots across 240 sessions. Synthetic text metrics in the rule tables are reproduced directly. Real font behaviour has separate text and rendering coverage.

In 10,000-node fixtures, multi-frame wrapped reordering and grid-gap drags took 4.4 and 4.7 ms p95 respectively. With 9,998 children in one frame the same scenarios took 11.4 and 11.2 ms. Over 60 measured previews per scenario, cancellation restored the original state, root publications remained zero and retained JavaScript heap growth after collection ranged from 616,364 to 965,712 bytes. Whole-host long-session profiling and other browser engines remain unverified.

The layout release is local. Component inheritance and variable bindings depend on roadmap rows 9 and 10. Page guides and layout grids belong to row 4. Final publication remains pending. No user action is required for the next slice.
