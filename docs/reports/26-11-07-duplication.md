# Layer duplication — 7 November 2026

React0.14.0, implementation `f6dfc3f`, branch `prompt/full-figcraft-port`; upstream evidence `0b97f3f1801a9b7b96fd7a4f3c0942a3f1a676f3`. Global baseline remains `8eb0b876`; full parity incomplete.

Implemented supported subtree cloning, fresh exact u64 identifiers, complete optional ID maps, root filtering and paint-order insertion. Top-level Frames move right by width+100; other roots copy in place. Explicit offsets use parent coordinates, matching native implementation despite its registry wording. Repeated copies use the current combined source/copy page-space displacement. Selection changes and undo retire remembered steps. Properties and hierarchy remain immutable; allocation and finite-geometry failures publish nothing. Ctrl/Meta+D and desktop/mobile Layer controls dispatch the same command.

Verification:391 pure tests,2 real local Auth checks, strict TypeScript, package/Next production builds and40/40 Chromium checks in53.4s. New browser flows verify repeated nudge/duplicate, selection reset, undo/redo, subtree/clipping, native download, recovery and mobile controls. Initial mobile test failed because it did not open the collapsed Layers panel; corrected the test and reran. No browser errors or failed requests. Inspected `test-results/duplicate-frame-desktop.png`. Temporary Auth fixtures removed; local preview stopped cleanly; no permanent account.

Existing performance guard p95/max: groups10.2/19ms, Frames9/13ms, moving Frames13.8/16.7ms, plain1.6/2.3ms, affine5.9/7.4ms, moving affine4.2/11ms. Smart-preview100-selected/10000-node p95/max3.9/5ms, input p952ms, zero root notifications; pointer/render p950.1/0.2ms. These are regression fixtures, not a duplication-throughput claim.

No schema/provider/identity/RLS/Storage/Realtime changes. Latest scoped Supabase MCP read succeeded; public tables remain empty pending online-file scope. Current local Auth suite passes. Graphify Rust duplication evidence current; React index stale/README-only. No Rust execution, publication or main merge; no user action required.

Required gaps: component-to-instance copying, variants, connector/measurement/pattern/prototype remapping, library analytics, rename preferences and auto-layout restrictions extend with their required model families. Alt-drag is the next consumer. [Property evidence](26-11-07-duplication-parity.html).
