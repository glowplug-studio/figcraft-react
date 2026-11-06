# Smart selection — 7 November 2026

React0.13.0, implementation `3326d26`, branch `prompt/full-figcraft-port`; upstream evidence `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. Global baseline remains `8eb0b876`; full parity incomplete.

Implemented source-derived visible/unlocked sibling tracks, mixed and negative gaps, atomic independent-axis spacing, regular row/column/grid insertion and swapping with unequal-size reflow, and local pixel rounding. Inspector fields/scrubs and native pink canvas gap handles/reorder rings use the same engine reducers. Captured gestures keep previews outside root snapshots, recovery and history; commit once, cancel on Escape/context changes, and add no history when returned to their source. Root notifications remain zero while dragging. Native size/zoom/slop/quantisation and outside-release rules are covered.

Verification: strict TypeScript,379 pure tests,2 real local Auth checks, package/Next production builds and38/38 Chromium checks in54.4s. New flows cover typed/scrubbed spacing, gap modifiers/cancellation, insertion/swap/undo/outside release, plain ring selection, pixel rounding, native save/recovery and mobile. No browser errors or failed requests. Inspected `test-results/smart-spacing-desktop.png`; generated logs/screenshots remain ignored. Temporary Auth users removed; no permanent account.

Continuous preview fixture:100 selected layers within10000 total nodes (9999 rectangles plus page),110 measured frames, full geometry+render+handles p95/max3.5/6.7ms, command p951.2ms, zero root notifications and cancellation restored committed content. Initial fixture exceeded the codec's10000-node limit by one page; corrected the fixture count without relaxing the limit. Other p95/max: groups9.3/12.5ms, Frames7.2/12.4ms, moving Frames14/16.6ms, plain1.2/3.2ms, affine5.8/8.2ms, moving affine5.9/11.4ms; pointer/render p950.1/0.2ms.

No schema/provider/identity/RLS/Storage/Realtime changes. Latest scoped Supabase MCP read succeeded; public tables still empty pending online-file scope. Current local Auth tests pass. Graphify exact Rust tracks/reflow current; React stale/README-only. No Rust execution, publication or main merge. No user action required.

Required gaps: general canvas transforms and marquee, other kinds, auto-layout/instance restrictions, configurable preferences, shared field arithmetic and multi-file gesture ownership. Next: subtree duplication/repeat offsets, required by Alt-drag. [Property evidence](26-11-07-smart-selection-parity.html).
